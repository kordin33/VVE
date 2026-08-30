import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The PostgreSQL-backed suites (decision matrix, fixture spine) each own
    // an isolated schema but apply migrations concurrently; database-global
    // steps like CREATE EXTENSION are not safe to race. The whole suite runs
    // in well under two seconds, so files run sequentially.
    fileParallelism: false,
    coverage: {
      enabled: false
    }
  }
});
