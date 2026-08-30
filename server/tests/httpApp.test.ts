import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

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

import { createHttpApp } from '../src/httpApp';
import { RoomManager } from '../src/rooms';
import type { EquationSolver } from '../src/services/aiSolver';

class StubSolver implements EquationSolver {
  constructor(private readonly responses: Record<string, string> = {}, private readonly shouldThrow = false) {}

  async solveEquation(equation: string): Promise<string> {
    if (this.shouldThrow) {
      throw new Error('solver offline');
    }
    return this.responses[equation] ?? '42';
  }
}

const createTestApp = (solver?: EquationSolver) =>
  createHttpApp({
    roomManager: new RoomManager(),
    aiSolver: solver ?? new StubSolver(),
    // Local development surface with the internal dev flag: keeps the legacy
    // rooms API and AI routes reachable so their behavior stays covered.
    environment: 'development',
    devSurface: true
  });

describe('HTTP API', () => {
  it('exposes health endpoint', async () => {
    const app = createTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('creates and retrieves rooms (development dev surface only)', async () => {
    const app = createTestApp();
    const createRes = await request(app).post('/api/rooms/').send({ roomId: 'demo', displayName: 'Demo' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.ownerSecret).toBeTypeOf('string');

    const listRes = await request(app).get('/api/rooms?limit=5');
    expect(listRes.status).toBe(200);
    expect(listRes.body.rooms).toHaveLength(1);

    const detailRes = await request(app).get('/api/rooms/demo');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.roomId).toBe('demo');
  });

  it('validates AI solver input', async () => {
    const app = createTestApp();
    const res = await request(app).post('/api/ai/solve-equation/').send({});
    expect(res.status).toBe(400);
  });

  it('returns AI solver results', async () => {
    const app = createTestApp(new StubSolver({ '2x+2=4': 'x = 1' }));
    const res = await request(app).post('/api/ai/solve-equation/').send({ equation: '2x+2=4' });
    expect(res.status).toBe(200);
    expect(res.body.solution).toBe('x = 1');
  });

  it('surface errors from AI solver', async () => {
    const app = createTestApp(new StubSolver({}, true));
    const res = await request(app).post('/api/ai/solve-equation/').send({ equation: '1+1=2' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});
