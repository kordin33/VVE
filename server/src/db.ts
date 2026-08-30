import knex, { Knex } from 'knex';
import { config } from './config';
import path from 'path';

let instance: Knex | null = null;

export const getDb = (): Knex => {
  if (!instance) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not configured.');
    }

    // Determine migrations directory based on environment
    const isProduction = process.env.NODE_ENV === 'production';
    // In production (Docker): /app/migrations-js (pure JS, copied by Dockerfile)
    // In dev: server/migrations-js
    const migrationsDir = isProduction
      ? '/app/migrations-js'
      : path.join(__dirname, '..', '..', 'migrations-js');

    console.log('[DB] Migrations directory:', migrationsDir);
    console.log('[DB] NODE_ENV:', process.env.NODE_ENV);

    instance = knex({
      client: 'pg',
      connection: config.databaseUrl,
      // 5.6: Increase pool limits; 5.9: add acquire timeout to avoid hanging queries
      pool: { min: 2, max: 20 },
      acquireConnectionTimeout: 10_000,
      migrations: {
        directory: migrationsDir,
        extension: 'js',
        loadExtensions: ['.js']
      }
    });
  }
  return instance;
};

export type DbConnection = Knex;
