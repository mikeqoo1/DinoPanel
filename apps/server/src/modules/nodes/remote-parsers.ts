import { containerStateSchema, isRealFilesystem } from '@dinopanel/shared';
import type { RemoteContainer, RemoteNodeMetrics } from '@dinopanel/shared';

// ---------------------------------------------------------------------------
// Pure parse functions — no I/O, no side effects
// ---------------------------------------------------------------------------

/**
 * Computes CPU usage percentage from two /proc/stat snapshots taken ~1s apart.
 * Returns a value in [0, 100] rounded to one decimal place.
 */
export function parseProcStatDelta(stat1: string, stat2: string): number {
  function extractFields(text: string): number[] {
    const line = text.split('\n').find((l) => /^cpu\s/.test(l));
    if (!line) return [];
    return line.trim().split(/\s+/).slice(1).map(Number);
  }
  const t1 = extractFields(stat1);
  const t2 = extractFields(stat2);
  if (t1.length < 4 || t2.length < 4) return 0;
  // Fields: user nice system idle iowait irq softirq steal (first 8)
  const total1 = t1.slice(0, 8).reduce((a, b) => a + b, 0);
  const total2 = t2.slice(0, 8).reduce((a, b) => a + b, 0);
  const idle1 = (t1[3] ?? 0) + (t1[4] ?? 0); // idle + iowait
  const idle2 = (t2[3] ?? 0) + (t2[4] ?? 0);
  const totalDelta = total2 - total1;
  if (totalDelta <= 0) return 0;
  const usage = (1 - (idle2 - idle1) / totalDelta) * 100;
  return Math.round(Math.min(100, Math.max(0, usage)) * 10) / 10;
}

/** Parses /proc/meminfo — returns bytes. */
export function parseMeminfo(meminfo: string): { used: number; total: number; free: number } {
  function readKb(key: string): number {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm').exec(meminfo);
    return m ? parseInt(m[1] ?? '0', 10) * 1024 : 0;
  }
  const total = readKb('MemTotal');
  const available = readKb('MemAvailable');
  return { total, free: available, used: Math.max(0, total - available) };
}

/** Parses /proc/loadavg — returns [1m, 5m, 15m]. */
export function parseLoadavg(loadavg: string): [number, number, number] {
  const parts = loadavg.trim().split(/\s+/);
  return [
    parseFloat(parts[0] ?? '') || 0,
    parseFloat(parts[1] ?? '') || 0,
    parseFloat(parts[2] ?? '') || 0,
  ];
}

/** Parses /proc/uptime — returns integer seconds. */
export function parseUptime(uptime: string): number {
  return Math.floor(parseFloat(uptime.trim().split(/\s+/)[0] ?? '') || 0);
}

/**
 * Parses `df -PTB1` output (header + data lines).
 * Columns: Filesystem Type 1B-blocks Used Available Use% Mounted
 *
 * Pseudo filesystems are dropped via the shared {@link isRealFilesystem}
 * predicate rather than `df -x` flags, so the remote table hides exactly what
 * the local disk tab hides (v0.6.1 de-noise). A hardcoded `-x` list drifts:
 * `efivarfs` on the real 235 slipped past `-x tmpfs -x devtmpfs -x overlay`
 * while the local table had been hiding it all along.
 */
export function parseDfPTB1(
  df: string,
): Array<{ mount: string; fstype: string; used: number; total: number }> {
  const result: Array<{ mount: string; fstype: string; used: number; total: number }> = [];
  for (const line of df.trim().split('\n')) {
    if (/^Filesystem\s/i.test(line)) continue; // header
    const cols = line.trim().split(/\s+/);
    if (cols.length < 7) continue;
    const fstype = cols[1] ?? '';
    const total = parseInt(cols[2] ?? '0', 10);
    const used = parseInt(cols[3] ?? '0', 10);
    const mount = cols[6] ?? '';
    if (!mount || !fstype) continue;
    if (!isRealFilesystem(fstype)) continue;
    result.push({ mount, fstype, used, total });
  }
  return result;
}

/**
 * Parses `docker ps -a --format '{{json .}}'` output (one JSON object per line).
 * Bad lines are discarded (onBadLine called); unknown state values fall back to 'dead'.
 */
export function parseDockerPsJson(
  output: string,
  onBadLine?: (line: string, err: unknown) => void,
): RemoteContainer[] {
  return output
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((line) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (err) {
        onBadLine?.(line, err);
        return [];
      }
      if (!raw || typeof raw !== 'object') return [];
      const r = raw as Record<string, unknown>;
      const stateResult = containerStateSchema.safeParse(r['State']);
      const container: RemoteContainer = {
        id: String(r['ID'] ?? r['Id'] ?? ''),
        name: String(r['Names'] ?? ''),
        image: String(r['Image'] ?? ''),
        state: stateResult.success ? stateResult.data : 'dead',
        status: String(r['Status'] ?? ''),
      };
      return [container];
    });
}

// ---------------------------------------------------------------------------
// parseMetricsOutput — orchestrates all parsers over METRICS_CMD stdout
// ---------------------------------------------------------------------------

/**
 * Splits METRICS_CMD stdout by '\n__DINO__\n' into 6 sections and assembles
 * a RemoteNodeMetrics object. Sections order matches METRICS_CMD constant.
 */
export function parseMetricsOutput(stdout: string): RemoteNodeMetrics {
  const sections = stdout.split('\n__DINO__\n');
  const stat1 = sections[0] ?? '';
  const loadavgStr = sections[1] ?? '';
  const meminfoStr = sections[2] ?? '';
  const uptimeStr = sections[3] ?? '';
  const stat2 = sections[4] ?? '';
  const dfStr = sections[5] ?? '';

  return {
    ts: Date.now(),
    cpu: {
      usage: parseProcStatDelta(stat1, stat2),
      loadAvg: parseLoadavg(loadavgStr),
    },
    mem: parseMeminfo(meminfoStr),
    disks: parseDfPTB1(dfStr),
    uptimeSec: parseUptime(uptimeStr),
  };
}
