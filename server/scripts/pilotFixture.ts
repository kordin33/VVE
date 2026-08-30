import fs from 'fs';
import path from 'path';
import { Knex } from 'knex';

import { getDb } from '../src/db';
import { createCapabilityAccess } from '../src/pilot/capabilityAccess';
import { createBoardForTeacher } from '../src/services/boardService';
import { getOrCreateTeacher } from '../src/services/teacherService';
import { PILOT_MANIFEST_VERSION } from '../src/pilot/availability';

/**
 * Deterministic local Pilot fixture (VVE-100, slice S0; re-routed in VVE-101).
 *
 * Seeds ONE teacher with ONE Managed Board into local PostgreSQL so
 * Playwright/browser tests can launch three contexts through the
 * CapabilityAccess stack:
 *
 *   - Administrator: passphrase login (ADMIN_PASSPHRASE → 12h session)
 *   - Teacher:       the printed Teacher Access Link (one active, retrievable)
 *   - Student:       the printed Board Access Link
 *
 * Determinism: fixed inputs (email, names, board title, twelve-month
 * validity). Re-running deletes the fixture teacher's boards and recreates
 * exactly one, so the seeded structure converges. The Teacher Access Link is
 * REUSED when already active (viewing never rotates — VVE-101), and
 * credentials are written to server/data/pilot-fixture.json, which is
 * gitignored.
 */

export const FIXTURE_TEACHER_EMAIL = 'pilot-teacher@vve-pilot.local';
export const FIXTURE_TEACHER_NAME = 'Nauczyciel Pilotowy';
export const FIXTURE_ORG_NAME = 'VVE Pilot Fixture';
export const FIXTURE_BOARD_TITLE = 'Lekcja pilotażowa';
export const FIXTURE_STUDENT_NAME = 'Uczeń';

/** The Pilot contract fixes Managed Board validity at twelve months. */
const addTwelveMonths = (from: Date): Date => {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 12);
  return d;
};

export interface PilotFixture {
  manifestVersion: string;
  seededAt: string;
  teacherId: string;
  boardId: string;
  publicSlug: string;
  /** ADMIN_PASSPHRASE the backend must run with for the Administrator context. */
  adminPassphrase: string;
  /** Teacher Access Link (opens the teacher login flow). */
  teacherAccessLink: string;
  /** Board Access Link (opens the student board entry). */
  boardAccessLink: string;
  validUntil: string;
}

export const seedPilotFixture = async (): Promise<PilotFixture> => {
  const db: Knex = getDb();
  const access = createCapabilityAccess();

  // Fixed organization (upsert by name keeps reruns deterministic).
  const existingOrg = await db('organizations').where({ name: FIXTURE_ORG_NAME }).first();
  let orgId: string | undefined = existingOrg?.id;
  if (!orgId) {
    const rows: Array<{ id: string }> = await db('organizations')
      .insert({ name: FIXTURE_ORG_NAME })
      .returning('id');
    orgId = rows[0]?.id;
  }
  if (!orgId) {
    throw new Error('Failed to resolve the fixture organization id.');
  }

  // Fixed teacher (upsert by email).
  const { teacher } = await getOrCreateTeacher({
    email: FIXTURE_TEACHER_EMAIL,
    fullName: FIXTURE_TEACHER_NAME,
    organizationId: orgId
  });
  if (!teacher.is_active) {
    await db('teachers').where({ id: teacher.id }).update({ is_active: true });
  }

  // Reset the teacher's boards to exactly one fixture board. Access logs
  // reference boards without a cascade, so they are removed first; yjs state,
  // updates cascade with the board, and fixture students are removed too so
  // reruns converge.
  const priorBoardIds = await db('boards').where({ teacher_id: teacher.id }).pluck('id');
  if (priorBoardIds.length > 0) {
    await db('board_access_logs').whereIn('board_id', priorBoardIds).del();
  }
  await db('boards').where({ teacher_id: teacher.id }).del();
  await db('students').where({ teacher_id: teacher.id }).del();

  // Exactly ONE active retrievable Teacher Access Link; re-seeding REUSES the
  // existing link (side-effect-free) instead of rotating it.
  const linkResult = await access.createOrReuseTeacherAccessLink({
    email: FIXTURE_TEACHER_EMAIL,
    internalLabel: FIXTURE_TEACHER_NAME,
    organizationId: orgId
  });
  if (!linkResult.ok) {
    throw new Error(`Seeding the Teacher Access Link failed: ${linkResult.reason}`);
  }
  // Fail loudly rather than emit a fixture whose link cannot log in.
  const decision = await access.decide({
    credential: { kind: 'teacherAccessLink', token: linkResult.token },
    action: 'teacher.openDashboard',
    now: new Date()
  });
  if (!decision.granted) {
    throw new Error(`Seeded Teacher Access Link was denied by CapabilityAccess: ${decision.reason}`);
  }

  // One Managed Board, twelve-month validity, one student label.
  const { board, studentToken } = await createBoardForTeacher({
    teacherId: teacher.id,
    organizationId: orgId,
    title: FIXTURE_BOARD_TITLE,
    studentName: FIXTURE_STUDENT_NAME,
    validUntil: addTwelveMonths(new Date())
  });

  // The board access link targets the app origin (config.teacherAppBaseUrl),
  // same origin the teacher access link uses.
  const appBase = new URL(linkResult.accessLink).origin;
  const boardAccessLink = `${appBase}/board/${board.public_slug}?token=${studentToken}`;

  const fixture: PilotFixture = {
    manifestVersion: PILOT_MANIFEST_VERSION,
    seededAt: new Date().toISOString(),
    teacherId: teacher.id,
    boardId: board.id,
    publicSlug: board.public_slug as string,
    adminPassphrase: process.env.ADMIN_PASSPHRASE || '',
    teacherAccessLink: linkResult.accessLink,
    boardAccessLink,
    validUntil: new Date(board.valid_until as Date).toISOString()
  };

  return fixture;
};

export const FIXTURE_OUTPUT_PATH = path.join(process.cwd(), 'data', 'pilot-fixture.json');

export const writeFixtureOutput = (fixture: PilotFixture, target = FIXTURE_OUTPUT_PATH): string => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  return target;
};

const isCli = (() => {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('pilotFixture.ts') || entry.endsWith('pilotFixture.js');
})();

if (isCli) {
  (async () => {
    if (!process.env.DATABASE_URL) {
      console.error(
        '[pilot-fixture] DATABASE_URL is required (local container: postgres://vve:vve-test@127.0.0.1:5433/vve_test).'
      );
      process.exit(1);
    }
    if (!process.env.ADMIN_PASSPHRASE) {
      console.error(
        '[pilot-fixture] ADMIN_PASSPHRASE is required; the backend must run with the same value.'
      );
      process.exit(1);
    }
    if (!process.env.TEACHER_APP_BASE_URL) {
      console.error(
        '[pilot-fixture] TEACHER_APP_BASE_URL is required so links point at the local app origin.'
      );
      process.exit(1);
    }

    const fixture = await seedPilotFixture();
    const target = writeFixtureOutput(fixture);

    console.log('[pilot-fixture] Seeded deterministic local Pilot fixture.');
    console.log(`[pilot-fixture] Teacher:  ${FIXTURE_TEACHER_EMAIL} (${FIXTURE_TEACHER_NAME})`);
    console.log(`[pilot-fixture] Board:    ${FIXTURE_BOARD_TITLE} (valid until ${fixture.validUntil})`);
    console.log('');
    console.log('Browser contexts:');
    console.log(`  Administrator: passphrase login at ${new URL(fixture.teacherAccessLink).origin}/admin/teachers`);
    console.log(`  Teacher:       ${fixture.teacherAccessLink}`);
    console.log(`  Student:       ${fixture.boardAccessLink}`);
    console.log('');
    console.log(`[pilot-fixture] Credentials written to ${target} (gitignored).`);
    process.exit(0);
  })().catch((error) => {
    console.error('[pilot-fixture] Seeding failed:', error);
    process.exit(1);
  });
}
