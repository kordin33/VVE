import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// VVE-101: launch the Pilot browser contexts from the deterministic local
// fixture (server/data/pilot-fixture.json, written by `npm run seed:pilot`
// through global-setup) through the CapabilityAccess stack:
//   - Teacher: opens the single active Teacher Access Link.
//   - Student: opens the Board Access Link; sees the exact Public Teacher
//     Identity (ADR-0009).
//   - Administrator: passphrase login (ADR-0005), side-effect-free list with
//     copyable links, explicit regeneration (old link dies immediately) and
//     deactivation — all with Polish copy.

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'server',
  'data',
  'pilot-fixture.json'
);

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const adminPassphrase = process.env.PILOT_ADMIN_PASSPHRASE || 'pilot-e2e-admin-passphrase';

test.describe('Pilot fixture: Administrator, Teacher, Student browser contexts', () => {
  test('Teacher opens the access link and lands on the dashboard with the seeded board', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // The Teacher Access Link is exchanged for a session cookie (proxied in
    // dev); viewing the dashboard never rotates the link.
    await page.goto(fixture.teacherAccessLink);

    await expect(page.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Lekcja pilotażowa').first()).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('Student opens the board link and reaches the collaborative canvas', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(fixture.boardAccessLink);

    // Board entry card shows the board title and the exact Public Teacher
    // Identity (ADR-0009).
    await expect(page.getByRole('heading', { name: 'Lekcja pilotażowa' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Dawid Furmaniuk - Matsin').first()).toBeVisible();

    await page.getByRole('button', { name: 'Dołącz do lekcji' }).click();

    // The collaborative canvas mounts and becomes visible.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20000 });

    await context.close();
  });

  test('Administrator signs in with the passphrase; viewing the list never rotates links', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/admin/teachers');

    // Login gate (ADR-0005): a wrong passphrase shows a Polish error.
    await expect(page.getByRole('heading', { name: 'Panel administratora' })).toBeVisible();
    await page.getByLabel('Hasło administratora').fill('zle-haslo');
    await page.getByRole('button', { name: 'Odblokuj panel' }).click();
    await expect(page.getByText('Nieprawidłowe hasło.')).toBeVisible();

    // The correct passphrase opens the panel.
    await page.getByLabel('Hasło administratora').fill(adminPassphrase);
    await page.getByRole('button', { name: 'Odblokuj panel' }).click();
    await expect(page.getByRole('heading', { name: 'Nauczyciele i linki dostępu' })).toBeVisible({ timeout: 10000 });

    // The fixture teacher is listed with its CURRENT retrievable link —
    // exactly the token the Teacher context can still use.
    const fixtureToken = new URL(fixture.teacherAccessLink).searchParams.get('token');
    const row = page.locator('.teacher-row', { hasText: 'pilot-teacher@vve-pilot.local' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('.keyway-channel')).toContainText(fixtureToken);

    // Reloading the panel (pure viewing) does NOT rotate the link.
    await page.reload();
    await expect(page.locator('.teacher-row', { hasText: 'pilot-teacher@vve-pilot.local' })).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('.teacher-row', { hasText: 'pilot-teacher@vve-pilot.local' }).locator('.keyway-channel')
    ).toContainText(fixtureToken);

    await context.close();
  });

  test('Regeneration is explicit: the old link dies immediately, the new one works', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    // Administrator session.
    await adminPage.goto('/admin/teachers');
    await adminPage.getByLabel('Hasło administratora').fill(adminPassphrase);
    await adminPage.getByRole('button', { name: 'Odblokuj panel' }).click();
    await expect(adminPage.getByRole('heading', { name: 'Nauczyciele i linki dostępu' })).toBeVisible({ timeout: 10000 });

    // Add a dedicated teacher so the fixture teacher's link stays untouched.
    await adminPage.getByLabel('Adres email').fill('e2e-regen@vve-pilot.local');
    await adminPage.getByLabel('Etykieta wewnętrzna (opcjonalnie)').fill('E2E Regeneracja');
    await adminPage.getByRole('button', { name: 'Dodaj i wygeneruj link' }).click();
    const newRow = adminPage.locator('.teacher-row', { hasText: 'e2e-regen@vve-pilot.local' });
    await expect(newRow).toBeVisible({ timeout: 10000 });

    // The fresh link opens the teacher dashboard in a separate context.
    const firstLink = await newRow.locator('.keyway-channel').innerText();
    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto(firstLink.trim());
    await expect(teacherPage.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15000 });

    // Explicit regeneration with the inline confirmation.
    await newRow.getByRole('button', { name: 'Regeneruj link' }).click();
    await expect(newRow.getByText('Regenerować link?')).toBeVisible();
    await newRow.getByRole('button', { name: 'Potwierdzam' }).click();

    // The panel shows a NEW link for that teacher.
    await expect(newRow.locator('.keyway-channel')).not.toContainText(
      new URL(firstLink.trim()).searchParams.get('token')
    );
    const newLink = (await newRow.locator('.keyway-channel').innerText()).trim();

    // The OLD link is denied with a Polish message (revocation is immediate).
    const oldPage = await teacherContext.newPage();
    await oldPage.goto(firstLink.trim());
    await expect(oldPage.getByText(/unieważniony/i).first()).toBeVisible({ timeout: 10000 });

    // The teacher's already-established session died with the regeneration
    // (durable credential version check on every request).
    await teacherPage.reload();
    await expect(teacherPage.getByText(/unieważniony/i).first()).toBeVisible({ timeout: 10000 });

    // The NEW link logs in again.
    const freshPage = await teacherContext.newPage();
    await freshPage.goto(newLink);
    await expect(freshPage.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15000 });

    // Deactivation: the fresh link is denied immediately, in Polish.
    await newRow.getByRole('button', { name: 'Wyłącz nauczyciela' }).click();
    await expect(newRow.getByText('Wyłączyć tego nauczyciela?')).toBeVisible();
    await newRow.getByRole('button', { name: 'Potwierdzam' }).click();
    await expect(newRow.locator('.keyway-label').first()).toHaveText(/Dostęp wyłączony/, { timeout: 10000 });

    const deniedPage = await teacherContext.newPage();
    await deniedPage.goto(newLink);
    await expect(deniedPage.getByText(/wyłączon/i).first()).toBeVisible({ timeout: 10000 });

    await teacherContext.close();
    await adminContext.close();
  });
});
