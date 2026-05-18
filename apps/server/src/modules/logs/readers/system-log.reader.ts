import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { SystemLogLine } from '@dinopanel/shared';

const DEFAULT_LIMIT = 200;

@Injectable()
export class SystemLogReader {
  /**
   * Spawn `journalctl --no-pager -n <limit>` and return parsed lines.
   * Falls back to an empty array on spawn failure (e.g. journalctl not
   * installed). Plain syslog tailing is left to a future iteration.
   */
  async read(opts: { limit?: number; grep?: string } = {}): Promise<SystemLogLine[]> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    return new Promise<SystemLogLine[]>((resolve) => {
      const args = [
        '--no-pager',
        '-o',
        'short-iso',
        '-n',
        String(limit),
      ];
      if (opts.grep) args.push('-g', opts.grep);
      const child = spawn('journalctl', args, { timeout: 10_000 });
      let stdout = '';
      child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
      child.on('error', () => resolve([]));
      child.on('close', () => resolve(parseSystemLog(stdout)));
    });
  }
}

const SYSTEM_LINE = /^(\S+T\S+)\s+(.+)$/;

export function parseSystemLog(stdout: string): SystemLogLine[] {
  const out: SystemLogLine[] = [];
  for (const raw of stdout.split('\n')) {
    if (!raw.trim()) continue;
    const m = SYSTEM_LINE.exec(raw);
    if (!m) {
      out.push({ ts: Date.now(), line: raw });
      continue;
    }
    const ts = Date.parse(m[1]!);
    out.push({ ts: Number.isFinite(ts) ? ts : Date.now(), line: m[2]! });
  }
  return out;
}
