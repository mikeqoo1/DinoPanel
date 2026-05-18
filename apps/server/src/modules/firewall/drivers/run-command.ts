import { spawn } from 'node:child_process';
import { FirewallCommandError } from '../firewall-driver';

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function runCommand(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = spawn(cmd, args, { timeout });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new FirewallCommandError('FIREWALL_TOOL_MISSING', `${cmd}: not installed`));
        return;
      }
      reject(new FirewallCommandError('FIREWALL_SPAWN_ERROR', err.message));
    });
    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

export function assertSuccess(result: CommandResult, op: string): void {
  if (result.exitCode === 0) return;
  if (/permission denied|operation not permitted/i.test(result.stderr)) {
    throw new FirewallCommandError(
      'FIREWALL_PERMISSION_DENIED',
      `${op}: permission denied`,
      result.stderr,
    );
  }
  throw new FirewallCommandError(
    'FIREWALL_COMMAND_FAILED',
    `${op} exited ${result.exitCode}`,
    result.stderr,
  );
}
