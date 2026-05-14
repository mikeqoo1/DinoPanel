/**
 * Idempotent admin seeding. Reads ADMIN_USERNAME and ADMIN_PASSWORD from env.
 * Used by install.sh and tests. Safe to re-run — exits if any user exists.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as bcrypt from 'bcryptjs';
import { join, isAbsolute, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { loadEnv } from '../config/env.schema';
import * as schema from '../database/schema';
import { passwordSchema, usernameSchema } from '@dinopanel/shared';

async function main() {
  const env = loadEnv(process.env);
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD env vars are required');
  }

  const usernameParsed = usernameSchema.safeParse(username);
  if (!usernameParsed.success) {
    throw new Error(`Invalid admin username: ${usernameParsed.error.issues[0]?.message}`);
  }
  const passwordParsed = passwordSchema.safeParse(password);
  if (!passwordParsed.success) {
    throw new Error(`Invalid admin password: ${passwordParsed.error.issues[0]?.message}`);
  }

  const dataDir = isAbsolute(env.DATA_DIR) ? env.DATA_DIR : resolve(process.cwd(), env.DATA_DIR);
  const dbPath = join(dataDir, 'dinopanel.db');
  mkdirSync(dataDir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const existing = await db.query.users.findFirst();
  if (existing) {
    console.log(`User already exists (username=${existing.username}); skipping seed.`);
    sqlite.close();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(schema.users).values({ username, passwordHash });
  console.log(`Created admin user: ${username}`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
