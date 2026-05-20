import type { DbEngine } from '@dinopanel/shared';

/**
 * Per-engine UI metadata: default image, default port, badge colour
 * class, friendly label key. Used by both the list table and the
 * Create dialog so the two stay in sync when defaults change.
 *
 * Colour classes map to Tailwind utility chains rather than custom
 * variants so we don't grow `components/ui/badge` for engine accents.
 */
export interface EngineMeta {
  engine: DbEngine;
  defaultImage: string;
  defaultPort: number;
  /** i18n key under `databases.engine.*` for the human label. */
  labelKey: string;
  /** Tailwind colour classes for badge background + text. */
  badgeClass: string;
}

export const ENGINE_META: Record<DbEngine, EngineMeta> = {
  mysql: {
    engine: 'mysql',
    defaultImage: 'mysql:8.4',
    defaultPort: 3306,
    labelKey: 'databases.engine.mysql',
    badgeClass: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  },
  mariadb: {
    engine: 'mariadb',
    defaultImage: 'mariadb:11.4',
    defaultPort: 3306,
    labelKey: 'databases.engine.mariadb',
    badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  postgresql: {
    engine: 'postgresql',
    defaultImage: 'postgres:16',
    defaultPort: 5432,
    labelKey: 'databases.engine.postgresql',
    badgeClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  },
  redis: {
    engine: 'redis',
    defaultImage: 'redis:7.4-alpine',
    defaultPort: 6379,
    labelKey: 'databases.engine.redis',
    badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  },
  mongodb: {
    engine: 'mongodb',
    defaultImage: 'mongo:7.0',
    defaultPort: 27017,
    labelKey: 'databases.engine.mongodb',
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
};

export const ENGINE_ORDER: DbEngine[] = [
  'mysql',
  'mariadb',
  'postgresql',
  'redis',
  'mongodb',
];
