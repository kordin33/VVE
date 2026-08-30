import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ADR-0005 stack: config snapshots the environment at first import, so the
// passphrase (and signing secrets) must be set before any app module loads.
vi.hoisted(() => {
  process.env.ADMIN_PASSPHRASE = 'test-admin-passphrase';
  process.env.TEACHER_SESSION_SECRET = 'security-test-session-secret';
  process.env.ADMIN_SESSION_SECRET = 'security-test-admin-secret';
  process.env.BOARD_WS_SECRET = 'security-test-ws-secret';
  process.env.TEACHER_APP_BASE_URL = 'http://app.test';
});

// Mock multer before importing httpApp
vi.mock('multer', () => {
  const multerStub = (opts?: any) => {
    // 4.7 test: capture limits for assertion
    (multerStub as any).__lastOpts = opts;
    return {
      single: () => (_req: any, _res: any, next: any) => next()
    };
  };
  (multerStub as any).memoryStorage = () => ({});
  return { default: multerStub };
});

vi.mock('csv-parse/sync', () => ({
  parse: () => []
}));

// Board ws token verification now lives in CapabilityAccess; keep the AI
// endpoint tests able to stub it without touching the real signing secret.
const mockVerifyBoardWsToken = vi.fn();
vi.mock('../src/pilot/capabilityAccess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pilot/capabilityAccess')>();
  return {
    ...actual,
    verifyBoardWsToken: (...args: any[]) => mockVerifyBoardWsToken(...args)
  };
});

import { createHttpApp } from '../src/httpApp';
import { RoomManager } from '../src/rooms';
import type { EquationSolver } from '../src/services/aiSolver';

class StubSolver implements EquationSolver {
  async solveEquation(): Promise<string> { return '42'; }
}

const createTestApp = (options: { environment?: 'development' | 'pilot'; devSurface?: boolean } = {}) =>
  createHttpApp({
    roomManager: new RoomManager(),
    aiSolver: new StubSolver(),
    ...options
  });

describe('4.3: Administrator surface requires a session (ADR-0005)', () => {
  it('rejects admin GET without any session (401, never 200)', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/admin/teachers');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Wymagane uwierzytelnienie administratora.');
  });

  it('never allows unauthenticated admin access in dev mode', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/admin/teachers');
    expect(res.status).not.toBe(200);
  });

  it('never accepts the passphrase in a URL, query string, or header', async () => {
    const app = createTestApp();
    // The login route only reads the JSON body; a query-string passphrase must
    // not authenticate anything.
    const login = await request(app).get('/api/admin/session?passphrase=whatever');
    expect(login.status).toBe(401);

    const admin = await request(app).get('/api/admin/teachers?passphrase=whatever');
    expect(admin.status).toBe(401);
    // The deleted x-admin-secret header path is gone for good.
    const adminHeader = await request(app).get('/api/admin/teachers').set('x-admin-secret', 'whatever');
    expect(adminHeader.status).toBe(401);
    const oldSecretHeader = await request(app)
      .get('/api/admin/teachers')
      .set('x-admin-secret', 'test-admin-passphrase');
    expect(oldSecretHeader.status).toBe(401);
  });

  it('exchanges the passphrase only via the JSON body and rate-limits failures', async () => {
    const app = createTestApp();

    // Wrong passphrase: Polish 401.
    const wrong = await request(app).post('/api/admin/session').send({ passphrase: 'not-it' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('Nieprawidłowe hasło.');

    // Missing passphrase: Polish 400.
    const missing = await request(app).post('/api/admin/session').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('Wprowadź hasło administratora.');

    // Correct passphrase: signed 12h HttpOnly session cookie.
    const ok = await request(app).post('/api/admin/session').send({ passphrase: 'test-admin-passphrase' });
    expect(ok.status).toBe(200);
    const setCookie = ok.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(/vve_admin_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toContain('test-admin-passphrase');

    // The session cookie authorizes the admin surface (DB-free check route).
    const cookie = setCookie.split(';')[0];
    const check = await request(app).get('/api/admin/session').set('Cookie', cookie);
    expect(check.status).toBe(200);
    expect(check.body.authenticated).toBe(true);

    // A request without the cookie stays unauthorized.
    const anonymous = await request(app).get('/api/admin/session');
    expect(anonymous.status).toBe(401);

    // Brute force: the default 5/min login limit trips to a Polish 429.
    let rateLimited = -1;
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app).post('/api/admin/session').send({ passphrase: 'nope' });
      if (res.status === 429) {
        rateLimited = i;
        expect(res.body.error).toBe('Zbyt wiele prób logowania. Odczekaj chwilę i spróbuj ponownie.');
        break;
      }
    }
    expect(rateLimited).toBeGreaterThanOrEqual(0);
  });

  it('logs out by clearing the session cookie', async () => {
    const app = createTestApp();
    const login = await request(app).post('/api/admin/session').send({ passphrase: 'test-admin-passphrase' });
    const cookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0];

    const logout = await request(app).delete('/api/admin/session').set('Cookie', cookie);
    expect(logout.status).toBe(200);
    expect(logout.headers['set-cookie']?.[0] ?? '').toMatch(/vve_admin_session=;/);

    // After logout the browser sends no cookie: the surface is unauthorized.
    const after = await request(app).get('/api/admin/session');
    expect(after.status).toBe(401);
    expect(after.body.authenticated).toBe(false);
  });
});

describe('4.2: AI board assistant availability and auth gating', () => {
  beforeEach(() => {
    mockVerifyBoardWsToken.mockReset();
  });

  it('is not registered in pilot mode (404, not 503/401)', async () => {
    // ADR-0007: the whole AI route family is unreachable in the Pilot.
    const app = createTestApp({ environment: 'pilot', devSurface: true });
    const res = await request(app)
      .post('/api/ai/board-assistant')
      .send({ boardId: 'test', message: 'hello' });
    expect(res.status).toBe(404);
  });

  it('rejects request without x-board-token header (development)', async () => {
    const app = createTestApp({ environment: 'development', devSurface: true });
    const res = await request(app)
      .post('/api/ai/board-assistant')
      .send({ boardId: 'test', message: 'hello' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token.*required/i);
  });

  it('rejects request with invalid token (development)', async () => {
    mockVerifyBoardWsToken.mockReturnValue(null);
    const app = createTestApp({ environment: 'development', devSurface: true });
    const res = await request(app)
      .post('/api/ai/board-assistant')
      .set('x-board-token', 'invalid-token')
      .send({ boardId: 'test', message: 'hello' });
    expect(res.status).toBe(401);
  });

  it('rejects student role (development)', async () => {
    mockVerifyBoardWsToken.mockReturnValue({ role: 'student', boardId: 'test' });
    const app = createTestApp({ environment: 'development', devSurface: true });
    const res = await request(app)
      .post('/api/ai/board-assistant')
      .set('x-board-token', 'student-token')
      .send({ boardId: 'test', message: 'hello' });
    expect(res.status).toBe(403);
  });
});

describe('4.5: Rate limiter on AI endpoints', () => {
  it('returns 429 after exceeding limit (development dev surface)', async () => {
    const app = createTestApp({ environment: 'development', devSurface: true });

    // The AI rate limiter allows 20 req/min per IP
    // We'll send 22 requests to /api/ai/solve-equation/ (which has its own handler)
    const results: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await request(app).post('/api/ai/solve-equation/').send({ equation: '1+1' });
      results.push(res.status);
    }
    // At least one should be 429
    expect(results).toContain(429);
  });

  it('does not register the AI rate limiter in pilot mode', async () => {
    const app = createTestApp({ environment: 'pilot' });
    const results: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await request(app).post('/api/ai/solve-equation/').send({ equation: '1+1' });
      results.push(res.status);
    }
    expect(results).not.toContain(429);
    expect(results.every((status) => status === 404)).toBe(true);
  });
});

describe('4.6: CSP headers present', () => {
  it('includes Content-Security-Policy header', async () => {
    const app = createTestApp();
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});

describe('4.7: Multer file size limit', () => {
  it('multer is configured with fileSize limit', async () => {
    // The import of adminTeachers triggers multer() with limits
    const multerMod = await import('multer');
    const lastOpts = (multerMod.default as any).__lastOpts;
    expect(lastOpts).toBeDefined();
    expect(lastOpts.limits).toBeDefined();
    expect(lastOpts.limits.fileSize).toBe(5 * 1024 * 1024);
  });
});
