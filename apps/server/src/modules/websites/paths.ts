import { join } from 'node:path';

/**
 * Filesystem layout under `WEBSITES_ROOT` (default `/opt/dinopanel`).
 * One source of truth for every path the websites + acme modules touch.
 */
export interface WebsitesPaths {
  /** WEBSITES_ROOT itself. */
  root: string;
  /** Per-site content lives here (`<root>/sites/<name>/`). */
  sitesDir: string;
  /** Per-site nginx confs live here (`<root>/nginx/conf.d/<name>.conf`). */
  nginxConfDir: string;
  /** ACME state root. */
  acmeDir: string;
  /** Issued cert output: `<acmeDir>/certs/<siteId>/{fullchain,privkey}.pem`. */
  acmeCertsDir: string;
  /** HTTP-01 challenge webroot, served back via `.well-known/acme-challenge/`. */
  acmeChallengeDir: string;
}

export function resolveWebsitesPaths(root: string): WebsitesPaths {
  return {
    root,
    sitesDir: join(root, 'sites'),
    nginxConfDir: join(root, 'nginx', 'conf.d'),
    acmeDir: join(root, 'acme'),
    acmeCertsDir: join(root, 'acme', 'certs'),
    acmeChallengeDir: join(root, 'acme', '.well-known', 'acme-challenge'),
  };
}

/**
 * Defense-in-depth: even though `siteNameSchema` rejects bad names at the
 * controller boundary, paths.ts is the last gate before fs and shell ops.
 * Reject anything that could escape `<root>/sites/<name>/` or
 * `<root>/nginx/conf.d/<name>.conf`.
 */
export function assertSafeSiteName(name: string): void {
  if (name.length === 0 || name.length > 63) {
    throw new Error(`Invalid site name: length out of range`);
  }
  if (name.startsWith('.') || name.startsWith('-')) {
    throw new Error(`Invalid site name: leading '.' or '-'`);
  }
  if (/[/\\\0]/.test(name)) {
    throw new Error(`Invalid site name: contains '/', '\\\\' or NUL`);
  }
  if (name.includes('..')) {
    throw new Error(`Invalid site name: contains '..'`);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    throw new Error(
      `Invalid site name: lowercase letters, digits, '_' and '-' only`,
    );
  }
}
