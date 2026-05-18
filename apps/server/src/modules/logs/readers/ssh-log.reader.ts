import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { SshLogEntry } from '@dinopanel/shared';

const DEFAULT_LIMIT = 200;

@Injectable()
export class SshLogReader {
  async read(opts: { limit?: number } = {}): Promise<SshLogEntry[]> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    return new Promise<SshLogEntry[]>((resolve) => {
      const child = spawn(
        'journalctl',
        ['--no-pager', '-u', 'sshd', '-o', 'short-iso', '-n', String(limit)],
        { timeout: 10_000 },
      );
      let stdout = '';
      child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
      child.on('error', () => resolve([]));
      child.on('close', () => resolve(parseSshLog(stdout)));
    });
  }
}

const SSH_LINE = /^(\S+T\S+)\s+\S+\s+sshd(?:\[\d+\])?:\s+(.+)$/;
const ACCEPTED = /^Accepted\s+\S+\s+for\s+(\S+)\s+from\s+([^\s]+)/;
const FAILED = /^Failed\s+\S+\s+for\s+(?:invalid user\s+)?(\S+)\s+from\s+([^\s]+)/;

export function parseSshLog(stdout: string): SshLogEntry[] {
  const out: SshLogEntry[] = [];
  for (const raw of stdout.split('\n')) {
    const lineMatch = SSH_LINE.exec(raw);
    if (!lineMatch) continue;
    const ts = Date.parse(lineMatch[1]!);
    const msg = lineMatch[2]!;
    const accepted = ACCEPTED.exec(msg);
    if (accepted) {
      out.push({
        ts: Number.isFinite(ts) ? ts : Date.now(),
        status: 'accepted',
        user: accepted[1]!,
        ip: accepted[2]!,
      });
      continue;
    }
    const failed = FAILED.exec(msg);
    if (failed) {
      out.push({
        ts: Number.isFinite(ts) ? ts : Date.now(),
        status: 'failed',
        user: failed[1]!,
        ip: failed[2]!,
      });
    }
  }
  return out;
}
