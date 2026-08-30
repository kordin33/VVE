import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHmac } from 'crypto';
import pg from 'pg';
import knex, { Knex } from 'knex';

/**
 * VVE-101 decision matrix for CapabilityAccess (Module 1).
 *
 * One Interface — `decide()` — governs HTTP and WebSocket admission. This
 * suite builds the matrix across Administrator / Teacher / Student
 * credentials × missing / invalid / regenerated-old / expired / revoked /
 * inactive / wrong-target / database-unavailable, executes the cross-board
 * isolation case, and proves the lifecycle contracts:
 *
 *  - opening the Administrator list is side-effect-free (no credential
 *    version or link changes — the QA P1 auto-rotation defect is dead);
 *  - explicit regeneration atomically invalidates ONLY the old credential
 *    (link, session, ws token) and preserves boards;
 *  - deactivation denies everything immediately;
 *  - every database failure fails CLOSED.
 *
 * Durable access state is a real local PostgreSQL schema (isolated per run).
 */

const { schemaName, adminPassphrase } = vi.hoisted(() => {
  const base =
    process.env.PILOT_MATRIX_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://vve:vve-test@127.0.0.1:5433/vve_test';
  const name = `vve_cap_matrix_test_${process.pid}`;
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${name},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.ADMIN_PASSPHRASE = 'matrix-admin-passphrase';
  process.env.TEACHER_SESSION_SECRET = 'matrix-teacher-session-secret';
  process.env.ADMIN_SESSION_SECRET = 'matrix-admin-session-secret';
  process.env.BOARD_WS_SECRET = 'matrix-board-ws-secret';
  process.env.TEACHER_APP_BASE_URL = 'http://app.test';
  return { schemaName: name, adminPassphrase: process.env.ADMIN_PASSPHRASE };
});

import { up as initialSchemaUp } from '../migrations/20241129000000_initial_schema';
import { up as permanentTokenUp } from '../migrations/20241207000000_add_teacher_permanent_token';
import { up as capabilityAccessUp } from '../migrations/20260829000000_capability_access';
import { createCapabilityAccess, issueBoardWsToken, issueTeacherSessionToken } from '../src/pilot/capabilityAccess';
import { createWsAdmission } from '../src/wsAdmission';
import { createHttpApp } from '../src/httpApp';
import { getDb } from '../src/db';
import { RoomManager } from '../src/rooms';
import type { EquationSolver } from '../src/services/aiSolver';

class StubSolver implements EquationSolver {
  async solveEquation(): Promise<string> {
    return '42';
  }
}

const localPostgresAvailable = async (): Promise<boolean> => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    await client.end().catch(() => undefined);
    return false;
  }
};

const hasPostgres = await localPostgresAvailable();
const pageText = (html: string): string => html.replace(/<[^>]+>/g, ' ');

describe.skipIf(!hasPostgres)('CapabilityAccess decision matrix (local PostgreSQL)', () => {
  let admin: pg.Client;
  let schemaKnex: Knex;
  let db: Knex;
  let access: ReturnType<typeof createCapabilityAccess>;
  let brokenAccess: ReturnType<typeof createCapabilityAccess>;
  let app: Express;
  let adminCookie: string;

  // Seeded durable state.
  const now = new Date();
  const inAMonth = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  let teacherAId = '';
  let teacherBId = '';
  let teacherDeactivatedId = '';
  let linkAToken = '';
  let linkBToken = '';
  let linkDeactivatedToken = '';
  let boardA1Id = '';
  let boardA1Slug = '';
  let boardA1StudentToken = '';
  let boardBId = '';
  let boardBSlug = '';
  let boardBStudentToken = '';
  let boardExpiredSlug = '';
  let boardExpiredStudentToken = '';
  let boardEndedSlug = '';
  let boardEndedStudentToken = '';
  let boardDeleteDueSlug = '';
  let boardDeleteDueStudentToken = '';
  let boardInactiveTeacherSlug = '';
  let boardInactiveTeacherStudentToken = '';

  const insertTeacher = async (email: string, isActive = true): Promise<string> => {
    const [row] = await db('teachers').insert({ email, full_name: `Label ${email}`, is_active: isActive }).returning('id');
    return row.id;
  };
  const insertLink = async (teacherId: string, cv: number): Promise<string> => {
    const token = `link-${teacherId.slice(0, 8)}-v${cv}-${Math.random().toString(36).slice(2, 10)}`;
    await db('teacher_access_links').insert({ teacher_id: teacherId, token, credential_version: cv, is_active: true });
    return token;
  };
  const insertBoard = async (params: {
    teacherId: string;
    suffix: string;
    studentToken: string;
    validUntil?: Date;
    accessEndedAt?: Date | null;
    deleteAfter?: Date | null;
  }): Promise<{ id: string; slug: string }> => {
    const id = `a1b2c3d4-e5f6-4789-abcd-${params.suffix.padEnd(12, '0')}`.slice(0, 36);
    const slug = `slug-${params.suffix}`;
    await db('boards').insert({
      id,
      teacher_id: params.teacherId,
      student_id: null,
      title: `Board ${params.suffix}`,
      public_slug: slug,
      student_token: params.studentToken,
      valid_until: params.validUntil ?? inAMonth,
      access_ended_at: params.accessEndedAt ?? null,
      delete_after: params.deleteAfter ?? null
    });
    return { id, slug };
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    schemaKnex = knex({ client: 'pg', connection: { connectionString: process.env.DATABASE_URL } });
    await initialSchemaUp(schemaKnex);
    await permanentTokenUp(schemaKnex);
    await capabilityAccessUp(schemaKnex);
    db = getDb();

    // ---- Durable state -----------------------------------------------------
    teacherAId = await insertTeacher('matrix-a@vve-pilot.local');
    teacherBId = await insertTeacher('matrix-b@vve-pilot.local');
    teacherDeactivatedId = await insertTeacher('matrix-off@vve-pilot.local', false);
    linkAToken = await insertLink(teacherAId, 1);
    linkBToken = await insertLink(teacherBId, 1);
    linkDeactivatedToken = await insertLink(teacherDeactivatedId, 1);

    const boardA1 = await insertBoard({ teacherId: teacherAId, suffix: 'aa', studentToken: 'student-token-a1' });
    boardA1Id = boardA1.id;
    boardA1Slug = boardA1.slug;
    boardA1StudentToken = 'student-token-a1';
    const boardB = await insertBoard({ teacherId: teacherBId, suffix: 'bb', studentToken: 'student-token-b' });
    boardBId = boardB.id;
    boardBSlug = boardB.slug;
    boardBStudentToken = 'student-token-b';
    const boardExpired = await insertBoard({
      teacherId: teacherAId, suffix: 'c0', studentToken: 'student-token-ex', validUntil: yesterday
    });
    boardExpiredSlug = boardExpired.slug;
    boardExpiredStudentToken = 'student-token-ex';
    const boardEnded = await insertBoard({
      teacherId: teacherAId, suffix: 'c1', studentToken: 'student-token-en', accessEndedAt: yesterday
    });
    boardEndedSlug = boardEnded.slug;
    boardEndedStudentToken = 'student-token-en';
    const boardDeleteDue = await insertBoard({
      teacherId: teacherAId, suffix: 'c2', studentToken: 'student-token-dd', deleteAfter: yesterday
    });
    boardDeleteDueSlug = boardDeleteDue.slug;
    boardDeleteDueStudentToken = 'student-token-dd';
    const boardInactiveTeacher = await insertBoard({
      teacherId: teacherDeactivatedId, suffix: 'c3', studentToken: 'student-token-of'
    });
    boardInactiveTeacherSlug = boardInactiveTeacher.slug;
    boardInactiveTeacherStudentToken = 'student-token-of';

    // ---- The Interface + adapters -------------------------------------------
    access = createCapabilityAccess();
    brokenAccess = createCapabilityAccess({
      // Every durable lookup fails: the database is unavailable.
      db: (() => {
        throw new Error('connection refused');
      }) as unknown as Knex
    });
    app = createHttpApp({
      roomManager: new RoomManager(),
      aiSolver: new StubSolver(),
      environment: 'pilot',
      capabilityAccess: access
    });

    const login = await request(app).post('/api/admin/session').send({ passphrase: adminPassphrase });
    expect(login.status).toBe(200);
    adminCookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  });

  afterAll(async () => {
    await getDb().destroy().catch(() => undefined);
    await schemaKnex?.destroy().catch(() => undefined);
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await admin.end().catch(() => undefined);
    }
  });

  type DecideInput = Parameters<typeof access.decide>[0];
  const decide = (input: DecideInput) => access.decide(input);
  const denial = async (input: DecideInput): Promise<string> => {
    const decision = await decide(input);
    expect(decision.granted).toBe(false);
    return decision.reason;
  };

  // -------------------------------------------------------------------------
  // Administrator
  // -------------------------------------------------------------------------

  it('administrator matrix: missing, invalid, expired, wrong action, grant', async () => {
    const nowDate = new Date();

    expect(await denial({
      credential: { kind: 'none' }, action: 'admin.manageTeachers', now: nowDate
    })).toBe('missing');

    expect(await denial({
      credential: { kind: 'adminSession', token: 'garbage' }, action: 'admin.manageTeachers', now: nowDate
    })).toBe('invalid');

    // A session exchanged 13h ago is beyond the twelve-hour bound.
    const stale = access.exchangeAdministratorPassphrase({
      passphrase: adminPassphrase, clientKey: 'matrix', now: new Date(nowDate.getTime() - 13 * 3600 * 1000)
    });
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(await denial({
        credential: { kind: 'adminSession', token: stale.sessionToken },
        action: 'admin.manageTeachers', now: nowDate
      })).toBe('expired');
      expect(access.verifyAdministratorSessionToken(stale.sessionToken, nowDate)).toBeNull();
    }

    // Fresh session grants exactly the admin action.
    const fresh = access.exchangeAdministratorPassphrase({ passphrase: adminPassphrase, clientKey: 'matrix', now: nowDate });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const grant = await decide({
      credential: { kind: 'adminSession', token: fresh.sessionToken }, action: 'admin.manageTeachers', now: nowDate
    });
    expect(grant).toMatchObject({ granted: true, role: 'administrator', action: 'admin.manageTeachers' });
    expect(grant.granted && grant.validUntil?.getTime()).toBe(fresh.expiresAt.getTime());

    // An administrator session cannot act on boards through this credential.
    expect(await denial({
      credential: { kind: 'adminSession', token: fresh.sessionToken }, action: 'board.read', now: nowDate
    })).toBe('wrongTarget');
  });

  it('administrator login is rate-limited per client', () => {
    const limited = createCapabilityAccess({ loginMax: 2, loginWindowMs: 60_000 });
    const first = limited.exchangeAdministratorPassphrase({ passphrase: 'nope-1', clientKey: 'brute', now: new Date() });
    const second = limited.exchangeAdministratorPassphrase({ passphrase: 'nope-2', clientKey: 'brute', now: new Date() });
    const third = limited.exchangeAdministratorPassphrase({ passphrase: adminPassphrase, clientKey: 'brute', now: new Date() });
    expect(first).toEqual({ ok: false, reason: 'invalid' });
    expect(second).toEqual({ ok: false, reason: 'invalid' });
    // Even the CORRECT passphrase is refused once the limit trips: the window
    // cools down before anything else is attempted.
    expect(third).toEqual({ ok: false, reason: 'rateLimited' });
  });

  // -------------------------------------------------------------------------
  // Teacher (Access Link + session)
  // -------------------------------------------------------------------------

  it('teacher link matrix: missing, invalid, revoked version, inactive, wrong action, grant', async () => {
    const nowDate = new Date();

    expect(await denial({ credential: { kind: 'none' }, action: 'teacher.openDashboard', now: nowDate })).toBe('missing');
    expect(await denial({
      credential: { kind: 'teacherAccessLink', token: 'not-a-token' }, action: 'teacher.openDashboard', now: nowDate
    })).toBe('invalid');

    // An active link whose embedded version no longer matches the teacher:
    // the durable credential version mismatch is a REVOCATION. (The database
    // forbids a second active row, so the mismatch is produced the way
    // regeneration produces it — by bumping the teacher's version.)
    await db('teachers').where({ id: teacherAId }).update({ access_credential_version: 2 });
    try {
      expect(await denial({
        credential: { kind: 'teacherAccessLink', token: linkAToken }, action: 'teacher.openDashboard', now: nowDate
      })).toBe('revoked');
    } finally {
      await db('teachers').where({ id: teacherAId }).update({ access_credential_version: 1 });
    }

    expect(await denial({
      credential: { kind: 'teacherAccessLink', token: linkDeactivatedToken }, action: 'teacher.openDashboard', now: nowDate
    })).toBe('inactive');

    // A teacher link opens the dashboard and nothing else.
    expect(await denial({
      credential: { kind: 'teacherAccessLink', token: linkAToken }, action: 'board.read', now: nowDate
    })).toBe('wrongTarget');

    const grant = await decide({
      credential: { kind: 'teacherAccessLink', token: linkAToken }, action: 'teacher.openDashboard', now: nowDate
    });
    expect(grant).toMatchObject({
      granted: true, role: 'teacher', teacherId: teacherAId, boardId: null, credentialVersion: 1
    });
  });

  it('teacher session matrix: invalid, expired, board actions, ownership, grant', async () => {
    const nowDate = new Date();
    const session = issueTeacherSessionToken(teacherAId, 1);

    expect(await denial({
      credential: { kind: 'teacherSession', token: 'junk' }, action: 'teacher.openDashboard', now: nowDate
    })).toBe('invalid');

    // Expired teacher session (same signed format, exp in the past).
    const payload = JSON.stringify({ teacherId: teacherAId, cv: 1, exp: nowDate.getTime() - 1000 });
    const base = Buffer.from(payload).toString('base64url');
    const expiredSession = `${base}.${createHmac('sha256', process.env.TEACHER_SESSION_SECRET ?? '').update(base).digest('base64url')}`;
    expect(await denial({
      credential: { kind: 'teacherSession', token: expiredSession }, action: 'teacher.openDashboard', now: nowDate
    })).toBe('expired');

    // Dashboard grant.
    expect(await decide({
      credential: { kind: 'teacherSession', token: session }, action: 'teacher.openDashboard', now: nowDate
    })).toMatchObject({ granted: true, role: 'teacher', teacherId: teacherAId });

    // Board grants are scoped to boards the teacher OWNS (durable check).
    expect(await decide({
      credential: { kind: 'teacherSession', token: session }, action: 'board.read', target: { boardSlug: boardA1Slug }, now: nowDate
    })).toMatchObject({ granted: true, role: 'teacher', boardId: boardA1Id, teacherId: teacherAId });

    // Teacher A's session cannot read Teacher B's board (cross-board).
    expect(await denial({
      credential: { kind: 'teacherSession', token: session }, action: 'board.read', target: { boardSlug: boardBSlug }, now: nowDate
    })).toBe('wrongTarget');

    // No target resolves to nothing.
    expect(await denial({
      credential: { kind: 'teacherSession', token: session }, action: 'board.read', now: nowDate
    })).toBe('wrongTarget');
  });

  // -------------------------------------------------------------------------
  // Student board link
  // -------------------------------------------------------------------------

  it('student matrix: grant scope, teacher-only actions, invalid token, unknown slug', async () => {
    const nowDate = new Date();
    const credential = { kind: 'studentBoardLink' as const, boardSlug: boardA1Slug, token: boardA1StudentToken };

    for (const action of ['board.read', 'board.edit', 'board.export'] as const) {
      expect(await decide({ credential, action, now: nowDate })).toMatchObject({
        granted: true, role: 'student', boardId: boardA1Id, teacherId: teacherAId
      });
    }

    // A Student grant never contains Teacher-only actions.
    for (const action of ['board.clear', 'board.rotateAccess', 'board.endAccess'] as const) {
      expect(await denial({ credential, action, now: nowDate })).toBe('invalid');
    }

    expect(await denial({
      credential: { kind: 'studentBoardLink', boardSlug: boardA1Slug, token: 'wrong-token' },
      action: 'board.read', now: nowDate
    })).toBe('invalid');

    expect(await denial({
      credential: { kind: 'studentBoardLink', boardSlug: 'missing-slug', token: boardA1StudentToken },
      action: 'board.read', now: nowDate
    })).toBe('wrongTarget');
  });

  it('cross-board isolation: board A credential is denied for board B (executable)', async () => {
    const nowDate = new Date();
    // The board A student token presented against board B's slug: the exact
    // target resolves to board B, the stored token does not match.
    const decision = await decide({
      credential: { kind: 'studentBoardLink', boardSlug: boardBSlug, token: boardA1StudentToken },
      action: 'board.edit', now: nowDate
    });
    expect(decision).toEqual({ granted: false, action: 'board.edit', reason: 'invalid' });

    // And the legitimate board B credential grants exactly board B.
    expect(await decide({
      credential: { kind: 'studentBoardLink', boardSlug: boardBSlug, token: boardBStudentToken },
      action: 'board.edit', now: nowDate
    })).toMatchObject({ granted: true, boardId: boardBId });
  });

  it('board state matrix: expired, ended, deletion-due, deactivated teacher', async () => {
    const nowDate = new Date();
    const cases: Array<[string, string, string]> = [
      [boardExpiredSlug, boardExpiredStudentToken, 'expired'],
      [boardEndedSlug, boardEndedStudentToken, 'revoked'],
      [boardDeleteDueSlug, boardDeleteDueStudentToken, 'revoked'],
      [boardInactiveTeacherSlug, boardInactiveTeacherStudentToken, 'inactive']
    ];
    for (const [slug, token, reason] of cases) {
      expect(await denial({
        credential: { kind: 'studentBoardLink', boardSlug: slug, token }, action: 'board.read', now: nowDate
      })).toBe(reason);
    }
  });

  // -------------------------------------------------------------------------
  // WebSocket admission (same Interface)
  // -------------------------------------------------------------------------

  it('WS admission matrix through decide(): grant, cross-board, stale versions, expiry, ended', async () => {
    const nowDate = new Date();
    const admission = createWsAdmission(access, false);

    // Teacher ws admission for the owned board.
    const teacherWs = issueBoardWsToken({ boardId: boardA1Id, role: 'teacher', teacherId: teacherAId, cv: 1 });
    const teacherIn = await admission.admit(boardA1Id, teacherWs, nowDate);
    expect(teacherIn.admitted && teacherIn.decision.role).toBe('teacher');

    // Student ws admission.
    const studentWs = issueBoardWsToken({ boardId: boardA1Id, role: 'student', cv: 1 });
    const studentIn = await admission.admit(boardA1Id, studentWs, nowDate);
    expect(studentIn.admitted && studentIn.decision.role).toBe('student');

    // Cross-board: board A's token cannot open board B's room.
    const cross = await admission.admit(boardBId, teacherWs, nowDate);
    expect(cross).toMatchObject({ admitted: false, closeCode: 1008 });

    // Stale teacher credential version (regenerated/deactivated teacher).
    await db('teachers').where({ id: teacherAId }).update({ access_credential_version: 2 });
    try {
      expect(await denial({
        credential: { kind: 'boardWs', boardId: boardA1Id, token: teacherWs }, action: 'board.edit', now: nowDate
      })).toBe('revoked');
      expect(await admission.admit(boardA1Id, teacherWs, nowDate)).toMatchObject({ admitted: false });
    } finally {
      await db('teachers').where({ id: teacherAId }).update({ access_credential_version: 1 });
    }

    // Stale board credential version (board access rotated — VVE-102's lever).
    await db('boards').where({ id: boardA1Id }).update({ access_credential_version: 2 });
    try {
      expect(await denial({
        credential: { kind: 'boardWs', boardId: boardA1Id, token: studentWs }, action: 'board.edit', now: nowDate
      })).toBe('revoked');
    } finally {
      await db('boards').where({ id: boardA1Id }).update({ access_credential_version: 1 });
    }

    // Expired ws token.
    const expiredWs = issueBoardWsToken({ boardId: boardA1Id, role: 'student', cv: 1, ttlMs: -1000 });
    expect(await denial({
      credential: { kind: 'boardWs', boardId: boardA1Id, token: expiredWs }, action: 'board.edit', now: nowDate
    })).toBe('expired');

    // Ended board denies at admission time.
    const endedBoard = await db('boards').where({ public_slug: boardEndedSlug }).first();
    const endedWs = issueBoardWsToken({ boardId: endedBoard.id, role: 'student', cv: 1 });
    expect(await admission.admit(endedBoard.id, endedWs, nowDate)).toMatchObject({ admitted: false });
  });

  it('WS admission: non-UUID legacy rooms denied in the Pilot, allowed only on the dev surface', async () => {
    const pilotAdmission = createWsAdmission(access, false);
    const devAdmission = createWsAdmission(access, true);

    expect(await pilotAdmission.admit('legacy-room', null)).toMatchObject({ admitted: false, closeCode: 1008 });
    expect(await pilotAdmission.admit('legacy-room', 'any-token')).toMatchObject({ admitted: false });
    const devLegacy = await devAdmission.admit('legacy-room', null);
    expect(devLegacy.admitted).toBe(true);

    // Board room without any token is denied.
    expect(await pilotAdmission.admit(boardA1Id, null)).toMatchObject({ admitted: false, closeCode: 1008 });
  });

  // -------------------------------------------------------------------------
  // Fail-closed: database unavailable
  // -------------------------------------------------------------------------

  it('FAILS CLOSED on database errors for every credential family', async () => {
    const nowDate = new Date();
    const teacherWs = issueBoardWsToken({ boardId: boardA1Id, role: 'teacher', teacherId: teacherAId, cv: 1 });
    const inputs: DecideInput[] = [
      { credential: { kind: 'teacherAccessLink', token: linkAToken }, action: 'teacher.openDashboard', now: nowDate },
      { credential: { kind: 'teacherSession', token: issueTeacherSessionToken(teacherAId, 1) }, action: 'teacher.openDashboard', now: nowDate },
      {
        credential: { kind: 'studentBoardLink', boardSlug: boardA1Slug, token: boardA1StudentToken },
        action: 'board.read', now: nowDate
      },
      { credential: { kind: 'boardWs', boardId: boardA1Id, token: teacherWs }, action: 'board.edit', now: nowDate }
    ];
    for (const input of inputs) {
      const decision = await brokenAccess.decide(input);
      expect(decision).toEqual({ granted: false, action: input.action, reason: 'unavailable' });
    }

    // The WS admission adapter fails closed too (the deleted fail-open path).
    const brokenAdmission = createWsAdmission(brokenAccess, false);
    const brokenWs = issueBoardWsToken({ boardId: boardA1Id, role: 'student', cv: 1 });
    const admitted = await brokenAdmission.admit(boardA1Id, brokenWs, nowDate);
    expect(admitted).toMatchObject({ admitted: false, closeCode: 1008 });

    // The administration list fails closed instead of masking as empty.
    const list = await brokenAccess.listTeacherAccessLinks();
    expect(list).toEqual({ error: 'unavailable' });
  });

  // -------------------------------------------------------------------------
  // Lifecycle proofs
  // -------------------------------------------------------------------------

  it('admin list/view is side-effect-free: no credential version or link changes', async () => {
    const snapshot = async () =>
      JSON.stringify(
        (await db('teacher_access_links').select('teacher_id', 'token', 'credential_version', 'is_active', 'regenerated_at'))
          .sort((a, b) => String(a.token).localeCompare(String(b.token)))
      ) + JSON.stringify(
        (await db('teachers').select('id', 'access_credential_version', 'is_active'))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      );

    const before = await snapshot();
    const first = await access.listTeacherAccessLinks();
    expect(Array.isArray(first)).toBe(true);
    await access.listTeacherAccessLinks();
    expect(await snapshot()).toBe(before);

    // The HTTP adapter view is equally read-only (GET / twice via the app).
    const httpList = await request(app).get('/api/admin/teachers').set('Cookie', adminCookie);
    expect(httpList.status).toBe(200);
    expect(httpList.body.teachers).toHaveLength(3);
    const httpAgain = await request(app).get('/api/admin/teachers').set('Cookie', adminCookie);
    expect(httpAgain.status).toBe(200);
    expect(await snapshot()).toBe(before);

    // The active link in the view is the one that works — copying it is
    // enough, the panel never needs to POST anything per teacher.
    if (!Array.isArray(first)) throw new Error('expected a list');
    const viewA = first.find((t) => t.teacherId === teacherAId);
    expect(viewA?.accessLink).toContain(linkAToken);
  });

  it('one active retrievable link per teacher is enforced by the database', async () => {
    await expect(insertLink(teacherAId, 1)).rejects.toThrow();
    const active = await db('teacher_access_links').where({ teacher_id: teacherAId, is_active: true });
    expect(active).toHaveLength(1);
  });

  it('regeneration invalidates ONLY the old credential and preserves boards', async () => {
    const boardsBefore = (await db('boards').where({ teacher_id: teacherBId }).select('id')).map((b) => b.id);
    const oldSession = issueTeacherSessionToken(teacherBId, 1);
    const oldWs = issueBoardWsToken({ boardId: boardBId, role: 'teacher', teacherId: teacherBId, cv: 1 });
    const nowDate = new Date();

    // The old credentials work before regeneration.
    expect(await decide({
      credential: { kind: 'teacherAccessLink', token: linkBToken }, action: 'teacher.openDashboard', now: nowDate
    })).toMatchObject({ granted: true });
    expect(await decide({
      credential: { kind: 'teacherSession', token: oldSession }, action: 'teacher.openDashboard', now: nowDate
    })).toMatchObject({ granted: true });

    const regenerated = await access.regenerateTeacherAccessLink(teacherBId);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;
    expect(regenerated.accessLink).not.toContain(linkBToken);

    // Old link denied (typed revocation), new link granted.
    expect(await denial({
      credential: { kind: 'teacherAccessLink', token: linkBToken }, action: 'teacher.openDashboard', now: nowDate
    })).toBe('revoked');
    expect(await decide({
      credential: { kind: 'teacherAccessLink', token: regenerated.token }, action: 'teacher.openDashboard', now: nowDate
    })).toMatchObject({ granted: true, teacherId: teacherBId, credentialVersion: 2 });

    // Old transport sessions die immediately (durable version check).
    expect(await denial({
      credential: { kind: 'teacherSession', token: oldSession }, action: 'teacher.openDashboard', now: nowDate
    })).toBe('revoked');
    expect(await denial({
      credential: { kind: 'boardWs', boardId: boardBId, token: oldWs }, action: 'board.edit', now: nowDate
    })).toBe('revoked');

    // Still exactly one active link, now at version 2.
    const active = await db('teacher_access_links').where({ teacher_id: teacherBId, is_active: true });
    expect(active).toHaveLength(1);
    expect(active[0].credential_version).toBe(2);
    const [teacherRow] = await db('teachers').where({ id: teacherBId }).select('access_credential_version');
    expect(teacherRow.access_credential_version).toBe(2);

    // Boards preserved.
    const boardsAfter = (await db('boards').where({ teacher_id: teacherBId }).select('id')).map((b) => b.id);
    expect(boardsAfter).toEqual(boardsBefore);

    linkBToken = regenerated.token;
  });

  it('deactivation denies everything immediately', async () => {
    const nowDate = new Date();
    const session = issueTeacherSessionToken(teacherBId, 2);
    const ws = issueBoardWsToken({ boardId: boardBId, role: 'teacher', teacherId: teacherBId, cv: 2 });
    const studentWs = issueBoardWsToken({ boardId: boardBId, role: 'student', cv: 1 });

    const result = await access.deactivateTeacher(teacherBId);
    expect(result).toEqual({ ok: true });

    expect(await denial({
      credential: { kind: 'teacherAccessLink', token: linkBToken }, action: 'teacher.openDashboard', now: nowDate
    })).toBe('inactive');
    expect(await denial({
      credential: { kind: 'teacherSession', token: session }, action: 'teacher.openDashboard', now: nowDate
    })).toBe('inactive');
    expect(await denial({
      credential: { kind: 'teacherSession', token: session }, action: 'board.read', target: { boardSlug: boardBSlug }, now: nowDate
    })).toBe('inactive');
    expect(await denial({
      credential: { kind: 'boardWs', boardId: boardBId, token: ws }, action: 'board.edit', now: nowDate
    })).toBe('inactive');
    // Student access to the deactivated teacher's board ends too.
    expect(await denial({
      credential: { kind: 'studentBoardLink', boardSlug: boardBSlug, token: boardBStudentToken },
      action: 'board.read', now: nowDate
    })).toBe('inactive');
    expect(await denial({
      credential: { kind: 'boardWs', boardId: boardBId, token: studentWs }, action: 'board.edit', now: nowDate
    })).toBe('inactive');

    // Idempotence is a typed outcome, not an error.
    expect(await access.deactivateTeacher(teacherBId)).toEqual({ ok: false, reason: 'alreadyInactive' });
    expect(await access.deactivateTeacher('00000000-0000-0000-0000-000000000000')).toEqual({ ok: false, reason: 'notFound' });
  });

  // -------------------------------------------------------------------------
  // HTTP transport conformance (same decisions, Polish responses)
  // -------------------------------------------------------------------------

  it('HTTP conformance: Polish denials and grants through the adapters', async () => {
    // Admin without session.
    const anonymous = await request(app).get('/api/admin/teachers');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error).toBe('Wymagane uwierzytelnienie administratora.');

    // Teacher dashboard with a valid link-established session.
    const login = await request(app).get(`/teacher/login?token=${linkAToken}`);
    expect(login.status).toBe(302);
    const teacherCookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const dashboard = await request(app).get('/api/teacher/boards').set('Cookie', teacherCookie);
    expect(dashboard.status).toBe(200);
    expect(Array.isArray(dashboard.body.boards)).toBe(true);

    // Dashboard without a session: Polish 401.
    const dashAnon = await request(app).get('/api/teacher/boards');
    expect(dashAnon.status).toBe(401);
    expect(dashAnon.body.error).toBe('Brak danych uwierzytelniających.');

    // Deactivated teacher link login: Polish denial page.
    const revokedLogin = await request(app).get(`/teacher/login?token=${linkDeactivatedToken}`);
    expect(revokedLogin.status).toBe(403);
    expect(pageText(revokedLogin.text)).toContain('wyłączon');

    // Student board entry with the exact Public Teacher Identity.
    const studentView = await request(app).get(`/board/${boardA1Slug}?token=${boardA1StudentToken}`);
    expect(studentView.status).toBe(200);
    expect(studentView.body.teacherName).toBe('Dawid Furmaniuk - Matsin');
    expect(studentView.body.role).toBe('student');
    expect(studentView.body.wsToken).toBeTruthy();

    // Expired board: Polish 401 with the typed reason.
    const expiredView = await request(app).get(`/board/${boardExpiredSlug}?token=${boardExpiredStudentToken}`);
    expect(expiredView.status).toBe(401);
    expect(expiredView.body.error).toBe('Dostęp wygasł.');
    expect(expiredView.body.reason).toBe('expired');

    // Ended board: revoked.
    const endedView = await request(app).get(`/board/${boardEndedSlug}?token=${boardEndedStudentToken}`);
    expect(endedView.status).toBe(401);
    expect(endedView.body.reason).toBe('revoked');

    // Unknown slug with a token: typed wrongTarget 404.
    const unknown = await request(app).get(`/board/nope?token=${boardA1StudentToken}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.reason).toBe('wrongTarget');
  });

  it('HTTP conformance: regeneration and deactivation are visible immediately over HTTP', async () => {
    const created = await request(app)
      .post('/api/admin/teachers')
      .set('Cookie', adminCookie)
      .send({ email: 'matrix-flow@vve-pilot.local', internalLabel: 'Flow Label' });
    expect(created.status).toBe(201);
    const newLink = created.body.accessLink as string;
    const newToken = new URL(newLink).searchParams.get('token') ?? '';

    const login = await request(app).get(`/teacher/login?token=${newToken}`);
    expect(login.status).toBe(302);
    const cookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const boards = await request(app).get('/api/teacher/boards').set('Cookie', cookie);
    expect(boards.status).toBe(200);

    // Regenerate over HTTP: the old link dies, the session dies, the new link works.
    const teacherId = created.body.teacherId as string;
    const regenerated = await request(app).post(`/api/admin/teachers/${teacherId}/regenerate-link`).set('Cookie', adminCookie);
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.note).toContain('unieważniony');

    const oldLogin = await request(app).get(`/teacher/login?token=${newToken}`);
    expect(oldLogin.status).toBe(401);
    expect(pageText(oldLogin.text)).toContain('unieważniony');
    const deadSession = await request(app).get('/api/teacher/boards').set('Cookie', cookie);
    expect(deadSession.status).toBe(401);

    const regeneratedToken = new URL(regenerated.body.accessLink).searchParams.get('token') ?? '';
    const newLogin = await request(app).get(`/teacher/login?token=${regeneratedToken}`);
    expect(newLogin.status).toBe(302);

    // Deactivate over HTTP: the fresh link is denied immediately.
    const deactivated = await request(app).post(`/api/admin/teachers/${teacherId}/deactivate`).set('Cookie', adminCookie);
    expect(deactivated.status).toBe(200);
    const denied = await request(app).get(`/teacher/login?token=${regeneratedToken}`);
    expect(denied.status).toBe(403);
    expect(pageText(denied.text)).toContain('wyłączon');

    // Mutations without the session are denied.
    const noSession = await request(app).post(`/api/admin/teachers/${teacherId}/regenerate-link`);
    expect(noSession.status).toBe(401);
  });
});
