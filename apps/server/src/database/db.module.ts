import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import type { AppConfig } from '../config/configuration';
import * as schema from './schema';

export const DRIZZLE_DB = Symbol('DRIZZLE_DB');
export type Db = BetterSQLite3Database<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService<{ app: AppConfig }>): Db => {
        const app = config.get<AppConfig>('app', { infer: true });
        if (!app) throw new Error('App config missing');
        const dataDir = isAbsolute(app.env.DATA_DIR)
          ? app.env.DATA_DIR
          : resolve(process.cwd(), app.env.DATA_DIR);
        const dbPath = join(dataDir, 'dinopanel.db');
        mkdirSync(dirname(dbPath), { recursive: true });

        const sqlite = new Database(dbPath);
        sqlite.pragma('journal_mode = WAL');
        sqlite.pragma('foreign_keys = ON');
        sqlite.pragma('synchronous = NORMAL');
        sqlite.pragma('busy_timeout = 5000');

        return drizzle(sqlite, { schema });
      },
    },
  ],
  exports: [DRIZZLE_DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  onApplicationShutdown() {
    // better-sqlite3 closes on process exit automatically; no-op here.
  }
}
