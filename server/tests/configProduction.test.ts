import { execFileSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * ADR-0005 production fail-fast: the process must refuse to start in the
 * production environment when the Administrator passphrase (or its session
 * signing secret) is missing. Verified in a real child process because the
 * config module snapshots the environment once at import time.
 */
describe('config production fail-fast (ADR-0005)', () => {
  const loadConfigInProduction = (env: NodeJS.ProcessEnv): string => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          '-e',
          "require('ts-node').register({ transpileOnly: true }); require('./src/config.ts'); console.log('CONFIG_LOADED');"
        ],
        {
          cwd: path.resolve(__dirname, '..'),
          env: { ...env, NODE_ENV: 'production' },
          stdio: 'pipe'
        }
      );
      return stdout.toString();
    } catch (error) {
      return (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    }
  };

  it('refuses to start without ADMIN_PASSPHRASE (and names it)', () => {
    const stderr = loadConfigInProduction({
      TEACHER_SESSION_SECRET: 'set',
      ADMIN_SESSION_SECRET: 'set',
      DATABASE_URL: 'postgres://set'
      // ADMIN_PASSPHRASE intentionally absent
    });
    expect(stderr).not.toContain('CONFIG_LOADED');
    expect(stderr).toContain('ADMIN_PASSPHRASE');
  });

  it('refuses to start when the admin session secret is the default fallback', () => {
    const stderr = loadConfigInProduction({
      TEACHER_SESSION_SECRET: 'set',
      ADMIN_PASSPHRASE: 'set',
      ADMIN_SESSION_SECRET: 'change-me-in-prod',
      DATABASE_URL: 'postgres://set'
    });
    expect(stderr).not.toContain('CONFIG_LOADED');
    expect(stderr).toContain('ADMIN_SESSION_SECRET');
  });

  it('starts with the full production secret set', () => {
    const stdout = loadConfigInProduction({
      TEACHER_SESSION_SECRET: 'set',
      ADMIN_PASSPHRASE: 'set',
      ADMIN_SESSION_SECRET: 'set',
      DATABASE_URL: 'postgres://set'
    });
    expect(stdout).toContain('CONFIG_LOADED');
  });
});
