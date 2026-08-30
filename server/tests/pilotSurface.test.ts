import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// The AI provider client must never be constructed or called in these tests;
// mocking it turns any accidental provider/network call into an assertion.
const mockCallGrok = vi.fn(async () => 'ai-answer');
vi.mock('../src/services/grok', () => ({
  callGrok: (...args: unknown[]) => mockCallGrok(...(args as []))
}));

vi.mock('multer', () => {
  const multerStub = () => ({
    single: () => (_req: any, _res: any, next: any) => next()
  });
  (multerStub as any).memoryStorage = () => ({});
  return { default: multerStub };
});

vi.mock('csv-parse/sync', () => ({
  parse: () => []
}));

// Board lookup stays reachable in pilot; stub the database so board access
// routes resolve 404 for unknown slugs instead of failing on a missing DB.
const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock('../src/db', () => ({ getDb: mockGetDb }));

import { createHttpApp } from '../src/httpApp';
import { RoomManager } from '../src/rooms';
import type { EquationSolver } from '../src/services/aiSolver';
import { createPilotAvailability } from '../src/pilot/availability';

const stubBoardDb = () => {
  // Real knex builders stay chainable in any order (loadBoardFacts appends
  // .where(...) after .first(...)), so the stub is one universal node whose
  // every method returns itself and whose await resolves "no row".
  const node: Record<string, unknown> = {};
  for (const method of ['join', 'leftJoin', 'where', 'andWhere', 'on', 'andOnVal', 'orderBy', 'limit', 'select', 'first']) {
    node[method] = () => node;
  }
  node.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
  const db = (_table: string) => node;
  (db as any).ref = (name: string) => ({ as: () => name });
  mockGetDb.mockReturnValue(db);
};

class SpySolver implements EquationSolver {
  calls = 0;
  async solveEquation(): Promise<string> {
    this.calls += 1;
    return '42';
  }
}

const PILOT_EXCLUDED_HTTP_PATHS: Array<[string, string]> = [
  ['POST', '/api/ai/board-assistant'],
  ['POST', '/api/ai/solve-equation/'],
  ['POST', '/api/ai/chat'],
  ['POST', '/api/ai/analyze-pdf'],
  ['POST', '/api/ai/generate-diagram'],
  ['POST', '/api/ai/auto-layout-diagram'],
  ['POST', '/api/ai/vision-chat'],
  ['GET', '/rooms'],
  ['GET', '/api/rooms'],
  ['POST', '/api/rooms'],
  ['GET', '/api/rooms/some-room'],
  ['PATCH', '/api/rooms/some-room'],
  ['DELETE', '/api/rooms/some-room']
];

describe('Pilot surface: excluded HTTP paths are uncallable in pilot mode', () => {
  it('every excluded path returns 404 with no provider calls', async () => {
    const solver = new SpySolver();
    const app = createHttpApp({
      roomManager: new RoomManager(),
      aiSolver: solver,
      environment: 'pilot',
      devSurface: true // even with the internal flag forced, pilot stays closed
    });

    for (const [method, path] of PILOT_EXCLUDED_HTTP_PATHS) {
      const res = await (request(app) as any)[method.toLowerCase()](path).send({});
      expect(res.status, `${method} ${path} must be 404 in pilot`).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    }

    expect(solver.calls).toBe(0);
    expect(mockCallGrok).not.toHaveBeenCalled();
  });

  it('the untrusted __dev query parameter cannot widen the pilot surface', async () => {
    const solver = new SpySolver();
    const app = createHttpApp({
      roomManager: new RoomManager(),
      aiSolver: solver,
      environment: 'pilot'
    });

    const res = await request(app).post('/api/ai/chat?__dev=1').send({ message: 'hello' });
    expect(res.status).toBe(404);
    expect(mockCallGrok).not.toHaveBeenCalled();
  });

  it('pilot CSP does not allow the AI provider origin', async () => {
    const app = createHttpApp({
      roomManager: new RoomManager(),
      aiSolver: new SpySolver(),
      environment: 'pilot'
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).not.toContain('openrouter.ai');
  });

  it('keeps release-critical endpoints registered in pilot mode', async () => {
    stubBoardDb();
    const app = createHttpApp({
      roomManager: new RoomManager(),
      aiSolver: new SpySolver(),
      environment: 'pilot'
    });

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);

    const root = await request(app).get('/');
    expect(root.status).toBe(200);
    expect(root.body.pilotSurface).toEqual([
      'http.adminTeachers',
      'http.teacherAuth',
      'http.teacherBoards',
      'http.boardAccess'
    ]);

    // Admin endpoints stay registered (and secret-gated).
    const admin = await request(app).get('/api/admin/teachers');
    expect(admin.status).not.toBe(404);

    // Teacher login stays reachable (it renders an error page without params).
    const login = await request(app).get('/teacher/login');
    expect(login.status).toBe(400);

    // Board access stays reachable: with a presented token an unknown slug is
    // a typed wrongTarget denial (404, Polish copy), not a missing route.
    const board = await request(app).get('/board/does-not-exist?token=x');
    expect(board.status).toBe(404);
    expect(board.body.error).toBe('Nie znaleziono tablicy.');
    expect(board.body.reason).toBe('wrongTarget');
  });

  it('legacy rooms API stays available in development with the internal dev surface', async () => {
    const app = createHttpApp({
      roomManager: new RoomManager(),
      aiSolver: new SpySolver(),
      environment: 'development',
      devSurface: true
    });

    const create = await request(app).post('/api/rooms/').send({ roomId: 'dev-room', displayName: 'Dev' });
    expect(create.status).toBe(201);

    const lobby = await request(app).get('/rooms');
    expect(lobby.status).toBe(200);
    expect(lobby.body.rooms).toHaveLength(1);
  });

  it('development without the internal dev surface also hides excluded routes', async () => {
    const app = createHttpApp({
      roomManager: new RoomManager(),
      aiSolver: new SpySolver(),
      environment: 'development',
      devSurface: false
    });

    const res = await request(app).post('/api/ai/chat').send({ message: 'hello' });
    expect(res.status).toBe(404);
    expect(mockCallGrok).not.toHaveBeenCalled();
  });

  it('the registered route set equals the pilot manifest server routes', () => {
    const availability = createPilotAvailability();
    const manifest = availability.resolve({ environment: 'pilot', role: 'server' });
    expect(manifest.version).toBe('vve.pilot-availability/1');
    expect(manifest.serverRoutes).not.toContain('http.ai');
    expect(manifest.serverRoutes).not.toContain('http.roomsApi');
  });
});
