import { join } from 'node:path';
import type { DbEngine, DbInstanceName } from '@dinopanel/shared';

/**
 * Filesystem layout for v0.5 backups module.
 * decisions.md D2: local-only at `<BACKUPS_ROOT>/<engine>/<instance>/`.
 *
 * File naming: `<unix-ts>-<source>.<ext>.gz`. Mongo extension is
 * `archive` (mongodump --archive output, already gzipped — see D6).
 */
export interface BackupsPaths {
  /** BACKUPS_ROOT itself. */
  root: string;
  /** Per-engine subtree (`<root>/<engine>/`). */
  engineDir: (engine: DbEngine) => string;
  /** Per-instance dir (`<root>/<engine>/<instance>/`). */
  instanceDir: (engine: DbEngine, name: DbInstanceName) => string;
  /** Absolute file path for one backup artefact. */
  file: (args: {
    engine: DbEngine;
    instanceName: DbInstanceName;
    timestampSeconds: number;
    source: 'manual' | 'scheduled';
    extension: string;
  }) => string;
}

export function resolveBackupsPaths(root: string): BackupsPaths {
  return {
    root,
    engineDir: (engine) => join(root, engine),
    instanceDir: (engine, name) => join(root, engine, name),
    file: ({ engine, instanceName, timestampSeconds, source, extension }) =>
      join(
        root,
        engine,
        instanceName,
        `${timestampSeconds}-${source}.${extension}.gz`,
      ),
  };
}
