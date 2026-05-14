/**
 * Standalone migrator. Run before server starts (or from install.sh).
 * Usage: tsx src/database/migrate.ts
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { loadEnv } from '../config/env.schema';

function main() {
  const env = loadEnv(process.env);
  const dataDir = isAbsolute(env.DATA_DIR) ? env.DATA_DIR : resolve(process.cwd(), env.DATA_DIR);
  const dbPath = join(dataDir, 'dinopanel.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite);
  const migrationsFolder = resolve(__dirname, '../../drizzle');

  console.log(`Running migrations from ${migrationsFolder} → ${dbPath}`);
  migrate(db, { migrationsFolder });
  console.log('Migrations applied.');
  sqlite.close();
}

main();
