import { spawn } from 'node:child_process';

/**
 * Idempotent SELinux relabel: `semanage fcontext -a -t <label> "<path>(/.*)?"`
 * then `restorecon -R <path>`. No-op on hosts without `semanage`
 * (every non-SELinux distro, plus minimal Rocky images that didn't
 * install `policycoreutils-python-utils`).
 *
 * This is the runtime-side counterpart to the `install.sh
 * relabel-path` subcommand (Phase 1.6). install.sh runs at deploy
 * time and applies the same label to the root tree; this helper
 * applies it to per-instance subdirs as DinoPanel creates them
 * (decisions Q2 implications + spec.md §1).
 *
 * Returns `{ ok: false, reason: 'not_installed' }` on hosts without
 * semanage so callers can ignore it cleanly. Never throws.
 */
export interface RelabelResult {
  ok: boolean;
  reason?: 'not_installed' | 'semanage_failed' | 'restorecon_failed';
  stderr?: string;
}

export async function relabelPath(
  path: string,
  label: string,
): Promise<RelabelResult> {
  // Check `semanage` exists — `command -v` returns 0 if found.
  const has = await runCommand('command', ['-v', 'semanage'], { silent: true });
  if (has.code !== 0) {
    return { ok: false, reason: 'not_installed' };
  }
  // Add the fcontext mapping (idempotent: `-a` errors if mapping
  // already exists, treat that as success). The `(/.*)?` suffix
  // covers every descendant.
  const fcontext = await runCommand('semanage', [
    'fcontext',
    '-a',
    '-t',
    label,
    `${path}(/.*)?`,
  ]);
  // `semanage fcontext -a` returns non-zero with "already defined"
  // — that's the steady state, not a failure.
  if (
    fcontext.code !== 0 &&
    !/already defined|sameLabelException/i.test(fcontext.stderr)
  ) {
    return { ok: false, reason: 'semanage_failed', stderr: fcontext.stderr };
  }
  const restore = await runCommand('restorecon', ['-R', path]);
  if (restore.code !== 0) {
    return { ok: false, reason: 'restorecon_failed', stderr: restore.stderr };
  }
  return { ok: true };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { silent?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      // ENOENT — the command itself doesn't exist. Surface as code 127
      // (POSIX "command not found") so callers don't crash on missing
      // semanage / restorecon.
      if (!opts.silent) {
        stderr += `${err.message}\n`;
      }
      resolve({ code: 127, stdout, stderr });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}
