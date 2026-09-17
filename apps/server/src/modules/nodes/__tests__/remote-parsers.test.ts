import { describe, it, expect, vi } from 'vitest';
import {
  parseProcStatDelta,
  parseMeminfo,
  parseLoadavg,
  parseUptime,
  parseDfPTB1,
  parseContainersOutput,
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

// Verbatim `df -PTB1` from the real remote node 192.168.199.235 (Rocky, xfs on
// LVM + md RAID /boot). Note efivarfs — a pseudo fs that no `-x` flag caught.
const DF_REAL_235 = `Filesystem          Type         1-blocks         Used    Available Capacity Mounted on
efivarfs            efivarfs       524288        65022       454146      13% /sys/firmware/efi/efivars
/dev/mapper/rl-root xfs      782736117760 402359894016 380376223744      52% /
/dev/mapper/rl-home xfs      160982630400  99390509056  61592121344      62% /home
/dev/md126p2        xfs        1063256064    620400640    442855424      59% /boot
/dev/md126p1        vfat        627900416      7397376    620503040       2% /boot/efi
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

  it('pseudo filesystems are dropped via the shared predicate', () => {
    const rows = parseDfPTB1(DF_WITH_ZERO_SIZE);
    expect(rows.find((r) => r.mount === '/dev/shm')).toBeUndefined();
    expect(rows.map((r) => r.mount)).toEqual(['/']);
  });

  // Captured from the real 192.168.199.235 before v0.6.2 shipped: efivarfs slips
  // past `df -x tmpfs -x devtmpfs -x overlay` but the local disk tab has always
  // hidden it, so remote and local must agree (one shared predicate, not two lists).
  it('real 235 output — efivarfs dropped, xfs/vfat kept', () => {
    const rows = parseDfPTB1(DF_REAL_235);
    expect(rows.map((r) => r.mount)).toEqual(['/', '/home', '/boot', '/boot/efi']);
    expect(rows.some((r) => r.fstype === 'efivarfs')).toBe(false);
    expect(rows.find((r) => r.mount === '/')?.total).toBe(782736117760);
  });

  it('returns [] for empty input', () => {
    expect(parseDfPTB1('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseContainersOutput — CONTAINERS_CMD output: wrapped container lines + per-engine status lines
// ---------------------------------------------------------------------------

const wrap = (engine: string, owner: string, c: object) => JSON.stringify({ engine, owner, c });
const status = (engine: string, owner: string, rc: number, err = '') => JSON.stringify({ engine, owner, rc, err });

const DOCKER_RUNNING = { ID: 'abc123def456', Names: 'nginx-proxy', Image: 'nginx:1.25', State: 'running', Status: 'Up 3 days' };
const DOCKER_EXITED = { ID: 'fed654cba321', Names: 'redis-cache', Image: 'redis:7', State: 'exited', Status: 'Exited (0) 2 hours ago' };
// podman shape: `Id` (not `ID`), `Names` is an array
const PODMAN_CONEXD = { Id: 'cafe0123beef', Names: ['conex-postgres'], Image: 'localhost/conex-postgres:18', State: 'running', Status: 'healthy' };

describe('parseContainersOutput', () => {
  it('collects containers from several engine/owner runs and tags each row', () => {
    const out = [
      wrap('docker', 'root', DOCKER_RUNNING),
      wrap('docker', 'root', DOCKER_EXITED),
      status('docker', 'root', 0),
      status('podman', 'root', 0),
      wrap('podman', 'conexd', PODMAN_CONEXD),
      status('podman', 'conexd', 0),
    ].join('\n');
    const r = parseContainersOutput(out);
    expect(r.containers).toHaveLength(3);
    expect(r.containers[0]).toMatchObject({ id: 'abc123def456', name: 'nginx-proxy', state: 'running', engine: 'docker', owner: 'root' });
    expect(r.containers[2]).toMatchObject({ id: 'cafe0123beef', name: 'conex-postgres', state: 'running', engine: 'podman', owner: 'conexd' });
    expect(r.engines).toEqual([
      { engine: 'docker', owner: 'root', ok: true, permissionDenied: false },
      { engine: 'podman', owner: 'root', ok: true, permissionDenied: false },
      { engine: 'podman', owner: 'conexd', ok: true, permissionDenied: false },
    ]);
  });

  it('marks an engine permissionDenied from its status line (docker socket refused for the SSH user)', () => {
    const out = [
      status('docker', 'conex', 1, 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock'),
      status('podman', 'conex', 0),
    ].join('\n');
    const r = parseContainersOutput(out);
    expect(r.engines[0]).toEqual({ engine: 'docker', owner: 'conex', ok: false, permissionDenied: true });
    expect(r.engines[1]?.ok).toBe(true);
    expect(r.containers).toEqual([]);
  });

  it('a failed engine with an unrelated error is ok:false, permissionDenied:false', () => {
    const r = parseContainersOutput(status('docker', 'root', 1, 'Cannot connect to the Docker daemon'));
    expect(r.engines[0]).toEqual({ engine: 'docker', owner: 'root', ok: false, permissionDenied: false });
  });

  it('unknown container state falls back to "dead"; unknown engine name lines are discarded via onBadLine', () => {
    const onBadLine = vi.fn();
    const r = parseContainersOutput(
      [wrap('docker', 'root', { ...DOCKER_RUNNING, State: 'zombie' }), wrap('lxc', 'root', DOCKER_RUNNING), 'not json {{{'].join('\n'),
      onBadLine,
    );
    expect(r.containers).toHaveLength(1);
    expect(r.containers[0]?.state).toBe('dead');
    expect(onBadLine).toHaveBeenCalledTimes(2);
  });

  it('empty output → no engines, no containers', () => {
    expect(parseContainersOutput('')).toEqual({ engines: [], containers: [] });
    expect(parseContainersOutput('\n\n')).toEqual({ engines: [], containers: [] });
  });

  it('all ContainerState enum values are accepted', () => {
    const states = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'];
    for (const state of states) {
      const r = parseContainersOutput(wrap('docker', 'root', { ID: 'x', Names: 'x', Image: 'x', State: state, Status: '' }));
      expect(r.containers[0]?.state).toBe(state);
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
