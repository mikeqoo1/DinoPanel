import { join } from 'node:path';
import type { DbEngine, DbInstanceName } from '@dinopanel/shared';

/**
 * Filesystem + naming layout for v0.4 databases module.
 * decisions.md Q2: bind-mount `<DATABASES_ROOT>/<engine>/<instance>/`.
 *
 * Container naming convention (also the canonical PMM service_name —
 * see decisions.md Q5): `dinopanel-<engine>-<instance>`.
 */
export interface DatabasesPaths {
  /** DATABASES_ROOT itself. */
  root: string;
  /** Per-engine subtree (`<root>/<engine>/`). */
  engineDir: (engine: DbEngine) => string;
  /** Per-instance bind-mount root (`<root>/<engine>/<instance>/`). */
  instanceDir: (engine: DbEngine, name: DbInstanceName) => string;
}

export function resolveDatabasesPaths(root: string): DatabasesPaths {
  return {
    root,
    engineDir: (engine) => join(root, engine),
    instanceDir: (engine, name) => join(root, engine, name),
  };
}

/**
 * Defense-in-depth on top of `dbInstanceNameSchema`. paths.ts is the
 * last gate before fs + shell + dockerode. Reject anything that could
 * escape `<root>/<engine>/<instance>/` or that docker / SELinux would
 * choke on. v0.4 keeps the surface narrower than v0.3 (no underscore)
 * because the same string also becomes the container name suffix and
 * the PMM service_name.
 */
export function assertSafeInstanceName(name: string): void {
  if (name.length === 0 || name.length > 32) {
    throw new Error(`Invalid db instance name: length out of range`);
  }
  if (name.startsWith('-')) {
    throw new Error(`Invalid db instance name: leading '-'`);
  }
  if (/[/\\\0]/.test(name)) {
    throw new Error(`Invalid db instance name: contains '/', '\\\\' or NUL`);
  }
  if (name.includes('..')) {
    throw new Error(`Invalid db instance name: contains '..'`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `Invalid db instance name: lowercase letters, digits and '-' only`,
    );
  }
}

export function containerNameOf(engine: DbEngine, name: DbInstanceName): string {
  // Also the PMM service_name. See decisions.md Q5 + spec.md §PromQL.
  return `dinopanel-${engine}-${name}`;
}
