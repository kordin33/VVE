import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import knex, { Knex } from 'knex';

/**
 * Real-PostgreSQL proof of the VVE-100 fixture spine: the deterministic local
 * Managed Board fixture and the admin→teacher→board→student flow through the
 * CapabilityAccess stack (VVE-101), on the Pilot HTTP surface.
 *
 * The suite owns an isolated schema (created/dropped per run) in the local
 * test database, so it never shares state with another suite or with the
 * seeded local fixture database contents.
 */

const { schemaName, adminPassphrase } = vi.hoisted(() => {
  const base =
    process.env.PILOT_FLOW_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://vve:vve-test@127.0.0.1:5433/vve_test';
  const name = `vve_pilot_flow_test_${process.pid}`;
  const url = new URL(base);
  // `public` stays in the path so shared extensions (citext) resolve; the
  // isolated schema is first, so every table resolves into it.
  url.searchParams.set('options', `-c search_path=${name},public`);
  // getDb()/config read the environment at first import, so the schema-scoped
  // DATABASE_URL (and secrets) must be set before any app module loads.
  process.env.DATABASE_URL = url.toString();
  const admin = 'pilot-flow-admin-passphrase';
  process.env.ADMIN_PASSPHRASE = admin;
  process.env.TEACHER_SESSION_SECRET = 'pilot-flow-session-secret';
  process.env.ADMIN_SESSION_SECRET = 'pilot-flow-admin-session-secret';
  process.env.BOARD_WS_SECRET = 'pilot-flow-ws-secret';
  process.env.TEACHER_APP_BASE_URL = 'http://app.test';
  return { schemaName: name, adminPassphrase: admin };
});

import { up as initialSchemaUp } from '../migrations/20241129000000_initial_schema';
import { up as permanentTokenUp } from '../migrations/20241207000000_add_teacher_permanent_token';
import { up as capabilityAccessUp } from '../migrations/20260829000000_capability_access';
import { createHttpApp } from '../src/httpApp';
import { getDb } from '../src/db';
import { RoomManager } from '../src/rooms';
import type { EquationSolver } from '../src/services/aiSolver';
import { driveCurrentStackLessonFlow } from './helpers/currentStackFlow';

class StubSolver implements EquationSolver {
  async solveEquation(): Promise<string> {
    return '42';
  }
}

const localPostgresAvailable = async (): Promise<boolean> => {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 1500
  });
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

describe.skipIf(!hasPostgres)('Pilot fixture: deterministic Managed Board fixture (local PostgreSQL)', () => {
  let admin: pg.Client;
  let schemaKnex: Knex;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schemaName}`);

    // Apply the schema migrations directly into the isolated schema.
    schemaKnex = knex({
      client: 'pg',
      connection: { connectionString: process.env.DATABASE_URL }
    });
    await initialSchemaUp(schemaKnex);
    await permanentTokenUp(schemaKnex);
    await capabilityAccessUp(schemaKnex);
  });

  afterAll(async () => {
    await getDb()
      .destroy()
      .catch(() => undefined);
    await schemaKnex?.destroy().catch(() => undefined);
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await admin.end().catch(() => undefined);
    }
  });

  const createPilotApp = () =>
    createHttpApp({
      roomManager: new RoomManager(),
      aiSolver: new StubSolver(),
      environment: 'pilot'
    });

  it('drives admin → teacher → board → student through CapabilityAccess on the pilot surface', async () => {
    const app = createPilotApp();

    const flow = await driveCurrentStackLessonFlow(app, {
      adminPassphrase,
      teacherEmail: 'flow-teacher@vve-pilot.local',
      teacherFullName: 'Flow Teacher',
      boardTitle: 'Flow Board'
    });

    // Administrator step produced a retrievable Teacher Access Link.
    expect(flow.teacherAccessPath).toMatch(/^\/teacher\/login\?token=[A-Za-z0-9_-]+$/);

    // Teacher step produced a session cookie and board facts.
    expect(flow.teacherSessionCookie).toMatch(/^teacher_session=/);
    expect(flow.boardId).toMatch(/^[0-9a-f-]{36}$/);
    expect(flow.publicSlug).toBeTruthy();

    // Student step: board facts with the exact Public Teacher Identity and a
    // scoped ws admission token.
    expect(flow.studentBoard.role).toBe('student');
    expect(flow.studentBoard.teacherName).toBe('Dawid Furmaniuk - Matsin');
    expect(flow.studentBoard.wsToken).toBeTruthy();

    // The same board recognizes the teacher session with the teacher role.
    const teacherView = await request(app)
      .get(`/board/${flow.publicSlug}`)
      .set('Cookie', flow.teacherSessionCookie);
    expect(teacherView.status).toBe(200);
    expect(teacherView.body.role).toBe('teacher');

    // A wrong student token is denied (fail closed).
    const wrongToken = await request(app).get(`/board/${flow.publicSlug}?token=not-the-token`);
    expect(wrongToken.status).toBe(401);

    // The fixture flow needs no AI provider and no legacy rooms API.
    const aiRes = await request(app).post('/api/ai/chat').send({ message: 'hello' });
    expect(aiRes.status).toBe(404);
    const lobbyRes = await request(app).get('/rooms');
    expect(lobbyRes.status).toBe(404);
  });

  it('is deterministic: re-running the flow for the same teacher converges to one teacher and one active link', async () => {
    const db = getDb();
    const before = await db('teachers').where({ email: 'flow-teacher@vve-pilot.local' }).first();
    expect(before).toBeTruthy();

    // Re-run the flow for the same teacher (admin create-or-reuse is
    // idempotent and NEVER rotates the existing link).
    const app = createPilotApp();
    const second = await driveCurrentStackLessonFlow(app, {
      adminPassphrase,
      teacherEmail: 'flow-teacher@vve-pilot.local',
      boardTitle: 'Flow Board 2'
    });

    const teachers = await db('teachers').where({ email: 'flow-teacher@vve-pilot.local' });
    expect(teachers).toHaveLength(1);
    expect(second.teacherId).toBe(before.id);

    const boards = await db('boards').where({ teacher_id: before.id });
    expect(boards).toHaveLength(2);

    // Exactly one active Teacher Access Link, and it is the one the second
    // run received (viewing/creating did not rotate it).
    const activeLinks = await db('teacher_access_links').where({ teacher_id: before.id, is_active: true });
    expect(activeLinks).toHaveLength(1);
    expect(second.teacherAccessPath).toContain(activeLinks[0].token);
  });
});
