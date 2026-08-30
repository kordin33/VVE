import { test, expect } from '@playwright/test';

// The Pilot surface removed the `/` product entry: no lobby, no automatic
// peer-room bootstrap (ADR-0010). The dev build keeps the dev surface OFF by
// default, so direct navigation to `/` must land on the unavailable page.
test.describe('Pilot surface: direct navigation on /', () => {
  test('shows the unavailable page instead of a lobby or auto-created room', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Ta strona nie jest dostępna' })).toBeVisible();

    // No whiteboard was auto-created or mounted.
    expect(await page.locator('canvas').count()).toBe(0);
    expect(page.url().includes('room=')).toBe(false);

    const criticalErrors = errors.filter(
      (e) => e.includes('Cannot access') || e.includes('is not defined') || e.includes('is not a function')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('the __dev flag opens the legacy developer surface in a development build only', async ({ page }) => {
    // In development builds, `?__dev=1` is the intentional internal flag for
    // the legacy peer-room surface (ADR-0010). In the Pilot build the same
    // parameter does nothing — covered by the unit suite against the shared
    // manifest (PILOT_ENVIRONMENT === 'pilot' ignores the flag entirely).
    await page.goto('/?__dev=1', { waitUntil: 'networkidle' });

    // The legacy Lobby appears for developers; it never shows for students.
    await expect(page.locator('body')).toBeVisible();
    expect(await page.getByRole('heading', { name: 'Ta strona nie jest dostępna' }).count()).toBe(0);
  });
});
