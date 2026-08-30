import path from 'path';
import dotenv from 'dotenv';

const envFiles = ['.env', '.env.secrets']; // load defaults first, then secrets override
const searchDirs = [process.cwd(), path.resolve(__dirname, '..')];
const loadedEnvFiles: Array<{ filename: string; path: string; loaded: boolean; parsedKeys: string[] }> = [];
const resolvedPaths = new Set<string>();

for (const dir of searchDirs) {
  for (const filename of envFiles) {
    const envPath = path.join(dir, filename);
    const normalizedPath = path.normalize(envPath);
    if (resolvedPaths.has(normalizedPath)) {
      continue;
    }
    resolvedPaths.add(normalizedPath);
    const result = dotenv.config({ path: normalizedPath, override: true });
    const error = result.error as NodeJS.ErrnoException | undefined;
    if (error && error.code !== 'ENOENT') {
      console.warn(`Failed to load ${filename} at ${normalizedPath}:`, error.message);
    }
    loadedEnvFiles.push({
      filename,
      path: normalizedPath,
      loaded: !result.error && Boolean(result.parsed),
      parsedKeys: result.parsed ? Object.keys(result.parsed) : []
    });
  }
}

// Config debug (only in development)
const loadedNames = loadedEnvFiles.filter((entry) => entry.loaded).map((entry) => entry.path);
const parsedKeys = loadedEnvFiles.flatMap((entry) => entry.parsedKeys);

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8000),
  nodeEnv: process.env.NODE_ENV || 'development',
  exposeMagicLinks: true,
  cleanupIntervalMs: 60_000,
  roomTtlMs: 24 * 60 * 60 * 1000, // 24 hours (increased for persistence)
  pingIntervalMs: 30_000,
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  ocrModel: process.env.OCR_MODEL || 'nvidia/nemotron-nano-12b-v2-vl:free',
  solverModel: process.env.SOLVER_MODEL || 'deepseek/deepseek-r1:free',
  // AI Board Assistant
  aiModel: process.env.BOARD_AI_MODEL || 'openai/gpt-oss-120b:exacto', // Default to free Grok model
  aiBaseUrl: 'https://openrouter.ai/api/v1',
  aiBoardAssistantEnabled: !!process.env.OPENROUTER_API_KEY && process.env.AI_BOARD_ASSISTANT_ENABLED !== 'false',
  databaseUrl: process.env.DATABASE_URL,
  teacherAppBaseUrl: process.env.TEACHER_APP_BASE_URL || process.env.APP_BASE_URL || 'https://app.whitevue.com',
  teacherSessionSecret: process.env.TEACHER_SESSION_SECRET || process.env.SESSION_SECRET || 'change-me-in-prod',
  teacherSessionCookie: process.env.TEACHER_SESSION_COOKIE || 'teacher_session',
  // Administrator access (ADR-0005): one shared passphrase exchanged for a
  // signed twelve-hour HttpOnly session. The passphrase is NEVER accepted in
  // a URL or query string — only in the POST /api/admin/session body.
  adminPassphrase: process.env.ADMIN_PASSPHRASE,
  adminSessionSecret: process.env.ADMIN_SESSION_SECRET || process.env.TEACHER_SESSION_SECRET || process.env.SESSION_SECRET || 'change-me-in-prod',
  adminSessionCookie: process.env.ADMIN_SESSION_COOKIE || 'vve_admin_session',
  adminSessionTtlMs: Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000),
  // Login rate limit (per client key, enforced inside CapabilityAccess).
  adminLoginMax: Number(process.env.ADMIN_LOGIN_MAX || 5),
  adminLoginWindowMs: Number(process.env.ADMIN_LOGIN_WINDOW_MS || 60_000),
  boardWsSecret: process.env.BOARD_WS_SECRET || process.env.TEACHER_SESSION_SECRET || process.env.SESSION_SECRET || 'change-me',
  // PilotAvailability inputs (Module 9): the production-like deployment is the
  // Pilot surface; local development keeps excluded features behind the
  // intentional internal VVE_DEV_SURFACE flag. Never settable by request input.
  // VVE_PILOT_SURFACE=1 forces the Pilot surface without NODE_ENV=production
  // (used by local pilots/E2E where production fail-fast checks do not apply).
  pilotEnvironment: (process.env.VVE_PILOT_SURFACE === '1' || process.env.NODE_ENV === 'production'
    ? 'pilot'
    : 'development') as 'pilot' | 'development',
  devSurface:
    process.env.NODE_ENV !== 'production' &&
    (process.env.VVE_DEV_SURFACE === '1' || process.env.VVE_DEV_SURFACE === 'true')
};

// 4.1: Fail-fast if critical secrets are missing in production
if (config.nodeEnv === 'production') {
  const missing: string[] = [];
  if (!process.env.TEACHER_SESSION_SECRET && !process.env.SESSION_SECRET) {
    missing.push('TEACHER_SESSION_SECRET (or SESSION_SECRET)');
  }
  if (config.teacherSessionSecret === 'change-me-in-prod') {
    missing.push('TEACHER_SESSION_SECRET (still using default fallback)');
  }
  if (!config.adminPassphrase) {
    missing.push('ADMIN_PASSPHRASE (shared Administrator passphrase, ADR-0005)');
  }
  if (config.adminSessionSecret === 'change-me-in-prod') {
    missing.push('ADMIN_SESSION_SECRET (still using default fallback)');
  }
  if (!config.databaseUrl) {
    missing.push('DATABASE_URL');
  }
  if (missing.length > 0) {
    throw new Error(
      `[config] Missing required secrets in production:\n  - ${missing.join('\n  - ')}\nSet these environment variables before starting the server.`
    );
  }
}

// C5: Warn in development mode about default secrets
if (config.nodeEnv !== 'production' && config.teacherSessionSecret === 'change-me-in-prod') {
  console.warn(
    '[config] WARNING: Using default teacherSessionSecret. Set TEACHER_SESSION_SECRET env var for security.'
  );
}

export const paths = {
  whiteboard: '/ws/whiteboard'
};
