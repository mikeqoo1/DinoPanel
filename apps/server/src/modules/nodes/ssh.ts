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
  'export LC_ALL=C; cat /proc/stat; echo __DINO__; cat /proc/loadavg; echo __DINO__; cat /proc/meminfo; echo __DINO__; cat /proc/uptime; echo __DINO__; sleep 1; cat /proc/stat; echo __DINO__; df -PTB1 -x tmpfs -x devtmpfs -x overlay';

export const DOCKER_PS_CMD = "export LC_ALL=C; docker ps -a --format '{{json .}}'";

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
// sshExec — throws for TOOL_MISSING / null (timeout) / 255; returns result otherwise
// ---------------------------------------------------------------------------

export async function sshExec(
  node: RemoteNode,
  remoteCmd: string,
  logger: SshLogger,
): Promise<CommandResult> {
  let result: CommandResult;
  try {
    result = await runCommand('ssh', buildSshArgs(node, remoteCmd), {
      maxOutputBytes: 4 * 1024 * 1024,
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
    // raw stderr to server log only
    logger.warn(
      { exitCode: result.exitCode, host: node.host, stderr: result.stderr },
      'nodes.ssh_failure',
    );
    const classified = classifySshFailure(result.exitCode, result.stderr);
    throw new HttpException({ code: classified.code, message: classified.message }, classified.status);
  }

  // exitCode 127 = docker not installed — expected node state (FIX-6: skip warn
  // to avoid ~2880 log lines/day/tab when containers tab is open on a node
  // without docker).
  if (result.exitCode !== 0 && result.exitCode !== 127 && result.stderr) {
    logger.warn(
      { exitCode: result.exitCode, host: node.host, stderr: result.stderr },
      'nodes.ssh_command_error',
    );
  }

  return result;
}
