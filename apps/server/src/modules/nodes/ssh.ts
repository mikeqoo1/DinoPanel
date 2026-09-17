import { HttpException } from '@nestjs/common';
import type { RemoteNode } from '@dinopanel/shared';
import {
  CommandError,
  commandErrorToHttp,
  runCommand,
  type CommandResult,
} from '../../common/shell/run-command';

// ponytail: no Unavailable-driver layer — ssh failures are per-request/per-node
// and not boot-probe-able; TOOL_MISSING handled naturally by commandErrorToHttp(err,'NODES') (D6)

/** Minimal logger interface — compatible with nestjs-pino Logger. */
export interface SshLogger {
  warn(obj: object, msg: string): void;
}

// ---------------------------------------------------------------------------
// Remote command constants — NEVER interpolate user input into these strings
// ---------------------------------------------------------------------------

export const METRICS_CMD =
  'export LC_ALL=C; cat /proc/stat; echo __DINO__; cat /proc/loadavg; echo __DINO__; cat /proc/meminfo; echo __DINO__; cat /proc/uptime; echo __DINO__; sleep 1; cat /proc/stat; echo __DINO__; df -PTB1';

/**
 * Remote container inventory. Runs `docker ps` AND `podman ps` (whichever exist) as the
 * SSH user, and — when running as root (natively or via sudo, see wrapRemote) — also
 * `podman ps` as every user that has a runtime dir under /run/user (rootless Podman
 * containers, e.g. Quadlet units with `User=`). Every container line is wrapped as
 * `{"engine","owner","c":{…ps json…}}`; every engine run ends with a status line
 * `{"engine","owner","rc","err"}` so a refused docker socket shows up as
 * permissionDenied for that engine instead of failing the whole request.
 *
 * Read-only by construction: only `ps` is ever invoked (AC7 grep + unit test). No user
 * input is interpolated. No single quotes — the whole script is passed via
 * `bash -c '…'` (wrapRemote). Neither engine → exit 127 → isDockerAbsent().
 */
export const CONTAINERS_CMD = `export LC_ALL=C; cd /
me=$(id -un)
hd=0; hp=0
command -v docker >/dev/null 2>&1 && hd=1
command -v podman >/dev/null 2>&1 && hp=1
[ $hd = 0 ] && [ $hp = 0 ] && exit 127
exec 3>&1
ps_as() {
  eng=$1; own=$2; shift 2
  err=$( { "$@" --format "{\\"engine\\":\\"$eng\\",\\"owner\\":\\"$own\\",\\"c\\":{{json .}}}"; } 2>&1 1>&3 ); rc=$?
  printf "{\\"engine\\":\\"%s\\",\\"owner\\":\\"%s\\",\\"rc\\":%s,\\"err\\":\\"%s\\"}\\n" "$eng" "$own" "$rc" "$(printf "%s" "$err" | head -c 200 | tr -d "\\"\\\\\\\\" | tr "\\n" " ")"
}
[ $hd = 1 ] && ps_as docker "$me" docker ps -a
[ $hp = 1 ] && ps_as podman "$me" podman ps -a
if [ "$(id -u)" = 0 ] && [ $hp = 1 ]; then
  for d in /run/user/*; do
    uid=\${d##*/}; [ "$uid" = 0 ] && continue
    u=$(id -nu "$uid" 2>/dev/null) || continue
    h=$(getent passwd "$u" | cut -d: -f6)
    ps_as podman "$u" sudo -n -u "$u" env XDG_RUNTIME_DIR="$d" HOME="$h" podman ps -a
  done
fi
exit 0`;

/**
 * Wrap a remote script for the login shell. With `sudo`, elevate via `sudo -S -k -p ""`:
 * the password is read from stdin (sshExec `input`), never argv; `-k` ignores any cached
 * timestamp so the stored password is validated on every run.
 */
export function wrapRemote(script: string, sudo: boolean): string {
  if (script.includes("'")) throw new Error('wrapRemote: script must not contain single quotes');
  const inner = `bash -c '${script}'`;
  return sudo ? `sudo -S -k -p "" ${inner}` : inner;
}

// ---------------------------------------------------------------------------
// buildSshArgs — pure function, exact arg order per spec/T-6
// ---------------------------------------------------------------------------

export function buildSshArgs(node: RemoteNode, remoteCmd: string): string[] {
  // `--` MUST come before the destination, not after. OpenSSH parses arguments
  // left-to-right: anything after `--` is treated as non-option (hostname first,
  // then remote command). If `--` follows the hostname, an option-shaped hostname
  // such as `-oProxyCommand=…` is parsed as an option and executed — confirmed on
  // OpenSSH_9.6p1. This is the layer-2 injection guard (layer 1 = HOST_REGEX).
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-p',
    String(node.port),
    '--',
    `${node.user}@${node.host}`,
    remoteCmd,
  ];
}

// ---------------------------------------------------------------------------
// classifySshFailure — pure function covering null (TIMEOUT) and 255 branches
// ---------------------------------------------------------------------------

export type SshFailureCode =
  | 'NODES_TIMEOUT'
  | 'NODES_AUTH_FAILED'
  | 'NODES_HOSTKEY_CHANGED'
  | 'NODES_UNREACHABLE';

export function classifySshFailure(
  exitCode: number | null,
  stderr: string,
): { code: SshFailureCode; status: number; message: string } {
  if (exitCode === null) {
    return { code: 'NODES_TIMEOUT', status: 504, message: 'SSH connection timed out' };
  }
  if (/Permission denied|bad permissions|UNPROTECTED PRIVATE KEY FILE/i.test(stderr)) {
    return { code: 'NODES_AUTH_FAILED', status: 502, message: 'SSH authentication failed' };
  }
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(stderr)) {
    return {
      code: 'NODES_HOSTKEY_CHANGED',
      status: 502,
      message:
        'SSH host key changed. To resolve: remove the stale entry from ~/.ssh/known_hosts and re-test.',
    };
  }
  return { code: 'NODES_UNREACHABLE', status: 502, message: 'SSH host unreachable' };
}

// ---------------------------------------------------------------------------
// isDockerAbsent — single source of truth for the docker-not-installed state
// ---------------------------------------------------------------------------

/** Returns true when the SSH result indicates no container engine (docker or
 *  podman) is installed on the remote host (exit 127, OR non-zero exit with an
 *  engine-specific not-found).
 *  Used in getContainers for the 200 {dockerAvailable:false} response AND in
 *  sshExec's warn-skip so the two never drift apart. */
export function isDockerAbsent(result: CommandResult): boolean {
  return (
    result.exitCode === 127 ||
    (result.exitCode !== 0 && /(docker|podman): (command )?not found/i.test(result.stderr))
  );
}

// ---------------------------------------------------------------------------
// isSudoFailed — the stored sudo password was rejected (or sudo wanted one we lack)
// ---------------------------------------------------------------------------

/** True when `sudo -S` refused: wrong password, password required but none accepted,
 *  or the user is not in sudoers. Expected node state (operator typo), not an error:
 *  getContainers returns 200 { sudoFailed: true } and sshExec skips the warn log. */
export function isSudoFailed(result: CommandResult): boolean {
  return (
    result.exitCode !== 0 &&
    /incorrect password attempt|Sorry, try again|a password is required|is not in the sudoers file|^sudo:/im.test(
      result.stderr,
    )
  );
}

// Max stderr bytes written to the log per warn call. The monitored node controls
// this string; unbounded logging is the same OOM vector as unbounded heap growth.
const STDERR_LOG_CAP = 2048;

// ---------------------------------------------------------------------------
// sshExec — throws for TOOL_MISSING / null (timeout) / 255; returns result otherwise
// ---------------------------------------------------------------------------

export interface SshExecOptions {
  /** Written to ssh's stdin (→ the remote command's stdin). Used for `sudo -S` passwords. */
  input?: string;
}

export async function sshExec(
  node: RemoteNode,
  remoteCmd: string,
  logger: SshLogger,
  opts: SshExecOptions = {},
): Promise<CommandResult> {
  let result: CommandResult;
  try {
    result = await runCommand('ssh', buildSshArgs(node, remoteCmd), {
      maxOutputBytes: 4 * 1024 * 1024,
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    });
  } catch (err) {
    if (err instanceof CommandError) {
      // raw stderr (if any) to server log only — not forwarded to client
      logger.warn({ kind: err.kind, host: node.host }, 'nodes.ssh_spawn_error');
      throw commandErrorToHttp(err, 'NODES');
    }
    throw err;
  }

  if (result.exitCode === null || result.exitCode === 255) {
    // Truncate stderr before logging — the monitored node controls this string and
    // could push megabytes per poll into the panel log (same threat as heap OOM).
    logger.warn(
      { exitCode: result.exitCode, host: node.host, stderr: result.stderr.slice(0, STDERR_LOG_CAP) },
      'nodes.ssh_failure',
    );
    const classified = classifySshFailure(result.exitCode, result.stderr);
    throw new HttpException({ code: classified.code, message: classified.message }, classified.status);
  }

  // Skip warn for docker-absent (isDockerAbsent covers exit 127 and docker-specific
  // not-found) — both are expected node states, not errors. Logging them would
  // produce ~2880+ lines/day/tab on a node without docker.
  if (
    result.exitCode !== 0 &&
    !isDockerAbsent(result) &&
    !isSudoFailed(result) &&
    result.stderr
  ) {
    logger.warn(
      { exitCode: result.exitCode, host: node.host, stderr: result.stderr.slice(0, STDERR_LOG_CAP) },
      'nodes.ssh_command_error',
    );
  }

  return result;
}
