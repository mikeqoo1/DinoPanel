import { spawn } from 'node:child_process';
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Generic host-command helper, lifted from the firewall module in v0.6
 * Phase 0 so the new toolbox module and firewall share one hardened
 * shell-out path. No `shell: true` (args are always an array), a timeout,
 * and a typed {@link CommandError} carrying a `kind` that the service layer
 * re-wraps into a coded HttpException via {@link commandErrorToHttp}.
 *
 * Why the re-wrap matters: `ApiExceptionFilter` only honours a `code` field
 * on an `HttpException`. A bare `Error` (which `CommandError` is) falls to
 * the generic 500 branch — so every service that shells out MUST catch
 * `CommandError` and rethrow `commandErrorToHttp(err, PREFIX)`.
 */

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type CommandErrorKind =
  | 'TOOL_MISSING' // binary (or sudo) not on PATH
  | 'PERMISSION_DENIED' // ran but was refused (needs root / sudoers entry)
  | 'COMMAND_FAILED' // ran and exited non-zero for another reason
  | 'SPAWN_ERROR'; // spawn failed for a non-ENOENT reason

export class CommandError extends Error {
  constructor(
    public readonly kind: CommandErrorKind,
    message: string,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export interface RunCommandOptions {
  timeoutMs?: number;
  /**
   * Prepend `sudo -n` so the command runs non-interactively under the
   * sudoers NOPASSWD contract (the nginx.service.ts posture). When the
   * panel runs as root this is a harmless no-op; on the non-root operator
   * path it is what lets mutating commands succeed.
   */
  sudo?: boolean;
}

export function runCommand(
  cmd: string,
  args: string[],
  opts: RunCommandOptions = {},
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const bin = opts.sudo ? 'sudo' : cmd;
    const argv = opts.sudo ? ['-n', cmd, ...args] : args;
    const child = spawn(bin, argv, { timeout });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new CommandError('TOOL_MISSING', `${bin}: not installed`));
        return;
      }
      reject(new CommandError('SPAWN_ERROR', err.message));
    });
    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

export function assertSuccess(result: CommandResult, op: string): void {
  if (result.exitCode === 0) return;
  if (
    /permission denied|operation not permitted|a password is required|^sudo:/im.test(result.stderr)
  ) {
    throw new CommandError('PERMISSION_DENIED', `${op}: permission denied`, result.stderr);
  }
  throw new CommandError('COMMAND_FAILED', `${op} exited ${result.exitCode}`, result.stderr);
}

/**
 * Best-effort probe — never throws. Returns true iff the command exits 0.
 * For boot-time `OnApplicationBootstrap` checks that decide whether a
 * feature is available/degraded without taking the panel down.
 */
export async function probeCommand(
  cmd: string,
  args: string[],
  opts: RunCommandOptions = {},
): Promise<boolean> {
  try {
    const result = await runCommand(cmd, args, opts);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const KIND_STATUS: Record<CommandErrorKind, number> = {
  TOOL_MISSING: HttpStatus.SERVICE_UNAVAILABLE, // 503 — host isn't set up for this op
  PERMISSION_DENIED: HttpStatus.SERVICE_UNAVAILABLE, // 503 — needs root / sudoers entry
  COMMAND_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  SPAWN_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

export interface CommandErrorToHttpOptions {
  /**
   * Include the raw host `stderr` in the client-facing `details`. Default
   * `false` — host stderr can leak filesystem paths / config internals and is
   * kept in server logs only (the caller logs it). Pass the module's `isDev`
   * flag so it still surfaces in development for debugging. v0.6 Phase 4
   * hardening — shared by every module that re-wraps a CommandError.
   */
  exposeStderr?: boolean;
}

/**
 * Re-wrap a {@link CommandError} as a coded `HttpException` so
 * `ApiExceptionFilter` surfaces `{ code: "<PREFIX>_<KIND>" }` to the client
 * instead of dropping a bare Error to a generic 500. `codePrefix` is the
 * module's namespace, e.g. `FIREWALL` → `FIREWALL_TOOL_MISSING`.
 *
 * `stderr` is NOT forwarded to the client unless `opts.exposeStderr` is set —
 * the service layer logs the full stderr server-side before calling this.
 */
export function commandErrorToHttp(
  err: CommandError,
  codePrefix: string,
  opts: CommandErrorToHttpOptions = {},
): HttpException {
  return new HttpException(
    {
      code: `${codePrefix}_${err.kind}`,
      message: err.message,
      ...(opts.exposeStderr && err.stderr ? { details: { stderr: err.stderr } } : {}),
    },
    KIND_STATUS[err.kind],
  );
}
