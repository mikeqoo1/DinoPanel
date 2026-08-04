import { describe, it, expect, vi } from 'vitest';
import {
  parseProcStatDelta,
  parseMeminfo,
  parseLoadavg,
  parseUptime,
  parseDfPTB1,
  parseDockerPsJson,
  parseMetricsOutput,
} from '../remote-parsers';

// ---------------------------------------------------------------------------
// Realistic Rocky Linux fixtures
// ---------------------------------------------------------------------------

// /proc/stat snapshot 1 (baseline)
const STAT1 = `cpu  450000 2500 120000 9800000 15000 0 3500 0 0 0
cpu0 225000 1250 60000 4900000 7500 0 1750 0 0 0
cpu1 225000 1250 60000 4900000 7500 0 1750 0 0 0
intr 12345678 0 0
ctxt 98765432
btime 1700000000
processes 54321
procs_running 2
procs_blocked 0
`;

// /proc/stat snapshot 2: ~1s later, ~54% CPU
// total delta = (450200+2510+121000+9801000+15050+0+3520) - (450000+2500+120000+9800000+15000+0+3500) = 2280
// idle delta = (9801000+15050) - (9800000+15000) = 1050
// usage = (2280-1050)/2280 ≈ 53.9%
const STAT2 = `cpu  450200 2510 121000 9801000 15050 0 3520 0 0 0
cpu0 225100 1255 60500 4900500 7525 0 1760 0 0 0
cpu1 225100 1255 60500 4900500 7525 0 1760 0 0 0
intr 12347500 0 0
ctxt 98770000
btime 1700000000
processes 54323
procs_running 3
procs_blocked 0
`;

const MEMINFO = `MemTotal:       16384000 kB
MemFree:         2048000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          4096000 kB
SwapCached:            0 kB
Active:          5120000 kB
Inactive:        3072000 kB
SwapTotal:       4194304 kB
SwapFree:        4194304 kB
`;

const LOADAVG = `0.42 0.38 0.31 2/567 12345\n`;

const UPTIME = `123456.78 987654.32\n`;

// df -PTB1 output: root + boot, with Type column (AC5/AC11)
const DF_PTB1 = `Filesystem             Type      1B-blocks       Used  Available Use% Mounted on
/dev/mapper/rl-root    xfs      18253611008 6420340736 11833270272  36% /
/dev/sda1              xfs        534773760   206471168   328302592  39% /boot
`;

// df with a swap=0-size entry (edge case for parseDfPTB1)
const DF_WITH_ZERO_SIZE = `Filesystem             Type      1B-blocks       Used  Available Use% Mounted on
/dev/mapper/rl-root    xfs      18253611008 6420340736 11833270272  36% /
tmpfs                  tmpfs              0          0          0    - /dev/shm
`;

// ---------------------------------------------------------------------------
// parseProcStatDelta
// ---------------------------------------------------------------------------

describe('parseProcStatDelta', () => {
  it('returns a value in [0, 100]', () => {
    const usage = parseProcStatDelta(STAT1, STAT2);
    expect(usage).toBeGreaterThanOrEqual(0);
    expect(usage).toBeLessThanOrEqual(100);
  });

  it('returns a non-zero value when CPU was active', () => {
    const usage = parseProcStatDelta(STAT1, STAT2);
    expect(usage).toBeGreaterThan(0);
  });

  it('returns 0 for identical snapshots (zero-delta)', () => {
    expect(parseProcStatDelta(STAT1, STAT1)).toBe(0);
  });

  it('returns 0 for empty/malformed input', () => {
    expect(parseProcStatDelta('', '')).toBe(0);
    expect(parseProcStatDelta('no cpu line', 'also no cpu')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseMeminfo
// ---------------------------------------------------------------------------

describe('parseMeminfo', () => {
  it('total = MemTotal in bytes', () => {
    expect(parseMeminfo(MEMINFO).total).toBe(16384000 * 1024);
  });

  it('free = MemAvailable in bytes', () => {
    expect(parseMeminfo(MEMINFO).free).toBe(8192000 * 1024);
  });

  it('used = total - free', () => {
    const { used, total, free } = parseMeminfo(MEMINFO);
    expect(used).toBe(total - free);
  });

  it('used <= total (AC5)', () => {
    const { used, total } = parseMeminfo(MEMINFO);
    expect(used).toBeLessThanOrEqual(total);
  });

  it('missing MemAvailable → free=0, used=total', () => {
    const mem = parseMeminfo('MemTotal: 2048000 kB\n');
    expect(mem.total).toBe(2048000 * 1024);
    expect(mem.free).toBe(0);
    expect(mem.used).toBe(2048000 * 1024);
  });
});

// ---------------------------------------------------------------------------
// parseLoadavg
// ---------------------------------------------------------------------------

describe('parseLoadavg', () => {
  it('returns [1m, 5m, 15m] as floats', () => {
    const [a, b, c] = parseLoadavg(LOADAVG);
    expect(a).toBeCloseTo(0.42);
    expect(b).toBeCloseTo(0.38);
    expect(c).toBeCloseTo(0.31);
  });

  it('returns [0,0,0] for empty input', () => {
    expect(parseLoadavg('')).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// parseUptime
// ---------------------------------------------------------------------------

describe('parseUptime', () => {
  it('returns floor of the first field in seconds', () => {
    expect(parseUptime(UPTIME)).toBe(123456);
  });

  it('returns 0 for empty input', () => {
    expect(parseUptime('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseDfPTB1 (AC5, AC11)
// ---------------------------------------------------------------------------

describe('parseDfPTB1', () => {
  it('skips the header line', () => {
    const rows = parseDfPTB1(DF_PTB1);
    expect(rows.every((r) => !r.mount.startsWith('Filesystem'))).toBe(true);
  });

  it('returns correct mount paths', () => {
    const mounts = parseDfPTB1(DF_PTB1).map((r) => r.mount);
    expect(mounts).toContain('/');
    expect(mounts).toContain('/boot');
  });

  it('returns non-empty fstype for all entries (AC5)', () => {
    const rows = parseDfPTB1(DF_PTB1);
    expect(rows.every((r) => r.fstype !== '')).toBe(true);
    expect(rows.find((r) => r.mount === '/')?.fstype).toBe('xfs');
  });

  it('returns bytes for used and total', () => {
    const root = parseDfPTB1(DF_PTB1).find((r) => r.mount === '/');
    expect(root?.total).toBe(18253611008);
    expect(root?.used).toBe(6420340736);
  });

  it('multi-disk — returns one row per non-header line', () => {
    expect(parseDfPTB1(DF_PTB1)).toHaveLength(2);
  });

  it('zero-size filesystem is parsed correctly', () => {
    const rows = parseDfPTB1(DF_WITH_ZERO_SIZE);
    const tmpfs = rows.find((r) => r.mount === '/dev/shm');
    expect(tmpfs).toBeDefined();
    expect(tmpfs?.total).toBe(0);
    expect(tmpfs?.used).toBe(0);
  });

  it('returns [] for empty input', () => {
    expect(parseDfPTB1('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseDockerPsJson (AC6, AC11)
// ---------------------------------------------------------------------------

const LINE_RUNNING = JSON.stringify({
  ID: 'abc123def456',
  Names: 'nginx-proxy',
  Image: 'nginx:1.25',
  State: 'running',
  Status: 'Up 3 days',
});

const LINE_EXITED = JSON.stringify({
  ID: 'fed654cba321',
  Names: 'redis-cache',
  Image: 'redis:7',
  State: 'exited',
  Status: 'Exited (0) 2 hours ago',
});

const LINE_UNKNOWN_STATE = JSON.stringify({
  ID: 'aaa111bbb222',
  Names: 'mystery',
  Image: 'alpine:latest',
  State: 'zombie',
  Status: 'some weird state',
});

const LINE_BAD_JSON = 'not valid json at all {{{';

describe('parseDockerPsJson', () => {
  it('parses multiple valid lines', () => {
    expect(parseDockerPsJson(`${LINE_RUNNING}\n${LINE_EXITED}`)).toHaveLength(2);
  });

  it('maps ID/Names/Image/State/Status correctly', () => {
    const containers = parseDockerPsJson(LINE_RUNNING);
    expect(containers[0]?.id).toBe('abc123def456');
    expect(containers[0]?.name).toBe('nginx-proxy');
    expect(containers[0]?.image).toBe('nginx:1.25');
    expect(containers[0]?.state).toBe('running');
    expect(containers[0]?.status).toBe('Up 3 days');
  });

  it('unknown state falls back to "dead", does not throw (AC6)', () => {
    const containers = parseDockerPsJson(LINE_UNKNOWN_STATE);
    expect(containers[0]?.state).toBe('dead');
  });

  it('bad JSON line is discarded, rest preserved; onBadLine called once (AC11)', () => {
    const onBadLine = vi.fn();
    const containers = parseDockerPsJson(
      `${LINE_RUNNING}\n${LINE_BAD_JSON}\n${LINE_EXITED}`,
      onBadLine,
    );
    expect(containers).toHaveLength(2);
    expect(onBadLine).toHaveBeenCalledOnce();
  });

  it('empty / whitespace-only output returns []', () => {
    expect(parseDockerPsJson('')).toEqual([]);
    expect(parseDockerPsJson('\n\n')).toEqual([]);
  });

  it('all ContainerState enum values are accepted', () => {
    const states = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'];
    for (const state of states) {
      const line = JSON.stringify({ ID: 'x', Names: 'x', Image: 'x', State: state, Status: '' });
      const containers = parseDockerPsJson(line);
      expect(containers[0]?.state).toBe(state);
    }
  });
});

// ---------------------------------------------------------------------------
// parseMetricsOutput — integration (AC5)
// ---------------------------------------------------------------------------

describe('parseMetricsOutput', () => {
  const stdout = [STAT1, LOADAVG, MEMINFO, UPTIME, STAT2, DF_PTB1].join('\n__DINO__\n');

  it('ts is a recent timestamp', () => {
    const before = Date.now();
    const metrics = parseMetricsOutput(stdout);
    expect(metrics.ts).toBeGreaterThanOrEqual(before);
  });

  it('cpu.usage in [0, 100] (AC5)', () => {
    const { cpu } = parseMetricsOutput(stdout);
    expect(cpu.usage).toBeGreaterThanOrEqual(0);
    expect(cpu.usage).toBeLessThanOrEqual(100);
  });

  it('cpu.loadAvg is a 3-tuple of numbers (AC5)', () => {
    const { cpu } = parseMetricsOutput(stdout);
    expect(cpu.loadAvg).toHaveLength(3);
    cpu.loadAvg.forEach((v) => expect(typeof v).toBe('number'));
  });

  it('mem.used <= mem.total (AC5)', () => {
    const { mem } = parseMetricsOutput(stdout);
    expect(mem.used).toBeLessThanOrEqual(mem.total);
  });

  it('disks contains mount "/" with non-empty fstype (AC5)', () => {
    const { disks } = parseMetricsOutput(stdout);
    const root = disks.find((d) => d.mount === '/');
    expect(root).toBeDefined();
    expect(root?.fstype).toBeTruthy();
  });

  it('uptimeSec > 0 (AC5)', () => {
    expect(parseMetricsOutput(stdout).uptimeSec).toBeGreaterThan(0);
  });
});
