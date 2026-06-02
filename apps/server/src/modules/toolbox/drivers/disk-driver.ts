import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { DiskBreakdown, DiskFilesystem } from '@dinopanel/shared';
import { runCommand, assertSuccess } from '../../../common/shell/run-command';

export interface DiskDriver {
  /** True only for the real df/du-backed driver; false on Unavailable. */
  readonly available: boolean;
  listFilesystems(): Promise<DiskFilesystem[]>;
  breakdown(root: string): Promise<DiskBreakdown>;
}

// ---------------------------------------------------------------------------
// Pure parsers — exported for golden-string tests (no DI).
// ---------------------------------------------------------------------------

/**
 * Parse `df -PB1`. POSIX `-P` guarantees exactly 6 columns; only the HEADER
 * row localizes (the dev host prints zh_TW headers), so we skip line 0 and
 * parse data rows positionally. `-B1` => raw bytes (no KiB math). Capacity is
 * `NN%` or `-` (pseudo filesystems) => usePercent null. Rows whose block
 * column is non-numeric (e.g. the all-dash `systemd-1` binfmt row under `-a`)
 * fail the numeric regex and are skipped.
 */
export function parseDf(stdout: string): DiskFilesystem[] {
  const out: DiskFilesystem[] = [];
  const lines = stdout.split('\n').slice(1); // drop the (possibly localized) header
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+%|-)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [, source, total, used, available, pct, mount] = m;
    out.push({
      source: source!,
      mount: mount!,
      total: Number(total),
      used: Number(used),
      available: Number(available),
      // Clamp: root-reserved blocks can push df Capacity past 100% (and the
      // schema caps at 100). "-" (pseudo fs) => null.
      usePercent: pct === '-' ? null : Math.min(100, Number(pct!.replace('%', ''))),
    });
  }
  return out;
}

/**
 * Parse `du -x -d1 -B1 <root>`: each line is "<bytes>\t<path>". The row whose
 * path === root is the grand total; the rest are depth-1 children, returned
 * largest-first. du may print permission-denied lines to stderr and exit
 * non-zero on unreadable subdirs but still emits valid stdout rows, so the
 * driver parses whatever stdout it got (no assertSuccess).
 */
export function parseDu(stdout: string, root: string): DiskBreakdown {
  let total = 0;
  const entries: { path: string; bytes: number }[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const bytes = Number(line.slice(0, tab));
    const path = line.slice(tab + 1).trim();
    if (!Number.isFinite(bytes)) continue;
    if (path === root) {
      total = bytes;
      continue;
    }
    entries.push({ path, bytes });
  }
  entries.sort((a, b) => b.bytes - a.bytes);
  return { root, total, entries };
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

@Injectable()
export class DfDuDiskDriver implements DiskDriver {
  readonly available = true;

  async listFilesystems(): Promise<DiskFilesystem[]> {
    // -P: POSIX 6-col layout (locale-proof rows). -B1: raw bytes.
    const r = await runCommand('df', ['-PB1']);
    assertSuccess(r, 'df -PB1');
    return parseDf(r.stdout);
  }

  async breakdown(root: string): Promise<DiskBreakdown> {
    // -x: stay on one filesystem. -d1: depth 1. -B1: bytes. `--` ends options.
    // Do NOT assertSuccess — du exits non-zero on unreadable subdirs but still
    // prints usable rows; parse best-effort.
    const r = await runCommand('du', ['-x', '-d1', '-B1', '--', root], { timeoutMs: 30_000 });
    return parseDu(r.stdout, root);
  }
}

/**
 * Fallback when `df` is not on PATH. Every op 503s with `DISK_NOT_CONFIGURED`;
 * GET /toolbox/status reports availability from `available` without calling
 * these. Mirrors UnavailableNtpDriver.
 */
export class UnavailableDiskDriver implements DiskDriver {
  readonly available = false;
  private throw503(): never {
    throw new ServiceUnavailableException({
      code: 'DISK_NOT_CONFIGURED',
      message: 'df is not installed on this host',
    });
  }
  listFilesystems(): Promise<DiskFilesystem[]> {
    this.throw503();
  }
  breakdown(): Promise<DiskBreakdown> {
    this.throw503();
  }
}
