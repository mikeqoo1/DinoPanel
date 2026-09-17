import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { NodesService } from '../nodes.service';
import { sshExec } from '../ssh';
import type * as SshModule from '../ssh';

// Mock sshExec so tests never open real SSH connections
vi.mock('../ssh', async (importOriginal) => {
  const actual = await importOriginal<typeof SshModule>();
  return { ...actual, sshExec: vi.fn() };
});

const mockSshExec = vi.mocked(sshExec);

// ---------------------------------------------------------------------------
// Minimal drizzle-chain mock for settings KV
// ---------------------------------------------------------------------------

function makeDb(initialJson?: string) {
  let stored: string | null = initialJson ?? null;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(stored !== null ? [{ value: stored }] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: { key: string; value: string }) => {
        const val = v.value;
        return {
          onConflictDoUpdate: () => {
            stored = val;
            return Promise.resolve(undefined);
          },
        };
      },
    }),
  };
}

const noopLogger = { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() };

const config = { get: () => ({ env: { JWT_SECRET: 'test-jwt-secret-'.repeat(3) }, isDev: true }) };

function makeService(initialJson?: string) {
  return new NodesService(makeDb(initialJson) as never, noopLogger as never, config as never);
}

/** Read the raw KV blob back out of the db mock (to assert what was persisted). */
async function rawStored(svc: NodesService): Promise<string> {
  const db = (svc as unknown as { db: ReturnType<typeof makeDb> }).db;
  const rows = await db.select().from().where().limit();
  return rows[0]?.value ?? '';
}

const NODE_INPUT = { name: 'rocky-235', host: '192.168.199.235', user: 'root', port: 22 };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('NodesService.list', () => {
  it('returns [] when KV is empty', async () => {
    expect(await makeService().list()).toEqual([]);
  });

  it('returns parsed nodes when KV has valid JSON', async () => {
    const existing = [{ id: 'x', name: 'n', host: 'h', port: 22, user: 'u' }];
    const nodes = await makeService(JSON.stringify(existing)).list();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe('x');
  });

  it('returns [] and warns when KV contains bad JSON', async () => {
    const nodes = await makeService('not-valid-json{{{{').list();
    expect(nodes).toEqual([]);
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  // FIX-2: non-array stored values must never reach ssh argv
  it.each([['{}'], ['null'], ['42']])(
    'returns [] and warns when stored value is non-array (%s)',
    async (json) => {
      vi.clearAllMocks();
      const nodes = await makeService(json).list();
      expect(nodes).toEqual([]);
      expect(noopLogger.warn).toHaveBeenCalled();
    },
  );

  it('drops a stored entry whose host starts with "-" (injection guard)', async () => {
    // A host like "-oProxyCommand=x" would be passed to ssh if not validated.
    // HOST_REGEX rejects leading "-", so the entry is silently dropped.
    const valid = { id: 'good', name: 'ok', host: '192.168.1.100', port: 22, user: 'root' };
    const exploit = { id: 'bad', name: 'bad', host: '-oProxyCommand=x', port: 22, user: 'root' };
    const nodes = await makeService(JSON.stringify([valid, exploit])).list();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe('good');
    expect(noopLogger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

describe('NodesService.add', () => {
  it('creates a node with a non-empty id and returns full list', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBeTruthy();
    expect(list[0]?.name).toBe('rocky-235');
    expect(list[0]?.port).toBe(22);
  });

  it('each call generates a unique id', async () => {
    const svc = makeService();
    const list1 = await svc.add(NODE_INPUT);
    const list2 = await svc.add({ ...NODE_INPUT, host: '192.168.199.236', name: 'n2' });
    const ids = list2.map((n) => n.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(list1[0]?.id).not.toBe(list2[1]?.id);
  });

  it('duplicate host:port → 409 NODES_DUPLICATE', async () => {
    const svc = makeService();
    await svc.add(NODE_INPUT);
    const err = await svc.add(NODE_INPUT).catch((e) => e) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect((err.getResponse() as Record<string, unknown>)['code']).toBe('NODES_DUPLICATE');
  });

  it('same host with different port is NOT a duplicate', async () => {
    const svc = makeService();
    await svc.add(NODE_INPUT);
    const list = await svc.add({ ...NODE_INPUT, port: 2222, name: 'n2' });
    expect(list).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('NodesService.remove', () => {
  it('removes the node by id', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    await svc.remove(list[0]!.id);
    expect(await svc.list()).toHaveLength(0);
  });

  it('silently ignores a non-existent id', async () => {
    await expect(makeService().remove('does-not-exist')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// testNode
// ---------------------------------------------------------------------------

describe('NodesService.testNode', () => {
  it('throws 404 NODES_NOT_FOUND for unknown id', async () => {
    const err = await makeService().testNode('no-such').catch((e) => e) as HttpException;
    expect(err.getStatus()).toBe(404);
    expect((err.getResponse() as Record<string, unknown>)['code']).toBe('NODES_NOT_FOUND');
  });

  it('returns { ok: true, latencyMs } on success', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    const result = await svc.testNode(list[0]!.id);
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('throws 500 NODES_COMMAND_FAILED for non-zero exit', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
    const err = await svc.testNode(list[0]!.id).catch((e) => e) as HttpException;
    expect((err.getResponse() as Record<string, unknown>)['code']).toBe('NODES_COMMAND_FAILED');
  });
});

// ---------------------------------------------------------------------------
// sudo password — stored encrypted, never returned, hasSudo exposed (v0.6.8)
// ---------------------------------------------------------------------------

describe('NodesService sudo password storage', () => {
  it('add() stores the password encrypted and list() only exposes hasSudo', async () => {
    const svc = makeService();
    const list = await svc.add({ ...NODE_INPUT, user: 'mike', sudoPassword: '110084' });
    expect(list[0]).toMatchObject({ user: 'mike', hasSudo: true });
    expect(JSON.stringify(list)).not.toContain('110084');
    expect(JSON.stringify(list)).not.toContain('sudoPasswordEnc');
    const raw = await rawStored(svc);
    expect(raw).toContain('sudoPasswordEnc');
    expect(raw).not.toContain('110084');
    const again = await svc.list();
    expect(again[0]).toMatchObject({ hasSudo: true });
    expect(JSON.stringify(again)).not.toContain('sudoPasswordEnc');
  });

  it('add() without a password → hasSudo:false and nothing encrypted persisted', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    expect(list[0]).toMatchObject({ hasSudo: false });
    expect(await rawStored(svc)).not.toContain('sudoPasswordEnc');
  });

  it('testNode() also validates the sudo password (sudo -S -k true) and reports sudoOk', async () => {
    const svc = makeService();
    const list = await svc.add({ ...NODE_INPUT, user: 'mike', sudoPassword: '110084' });
    mockSshExec
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // plain `true`
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // sudo probe
    const r = await svc.testNode(list[0]!.id);
    expect(r).toMatchObject({ ok: true, sudoOk: true });
    const [, cmd, , opts] = mockSshExec.mock.calls[1]!;
    expect(cmd).toContain('sudo -S');
    expect(cmd).toContain('-k');
    expect(opts?.input).toBe('110084\n');
  });

  it('testNode() reports sudoOk:false when sudo rejects the password, still ok:true for ssh', async () => {
    const svc = makeService();
    const list = await svc.add({ ...NODE_INPUT, user: 'mike', sudoPassword: 'wrong' });
    mockSshExec
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'sudo: 1 incorrect password attempt' });
    const r = await svc.testNode(list[0]!.id);
    expect(r).toMatchObject({ ok: true, sudoOk: false });
  });

  it('testNode() without a password does not probe sudo and omits sudoOk', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    const r = await svc.testNode(list[0]!.id);
    expect(r.ok).toBe(true);
    expect('sudoOk' in r).toBe(false);
    expect(mockSshExec).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// getContainers — engines, containers, expected node states (AC6)
// ---------------------------------------------------------------------------

describe('NodesService.getContainers', () => {
  const wrap = (engine: string, owner: string, c: object) => JSON.stringify({ engine, owner, c });
  const status = (engine: string, owner: string, rc: number, err = '') => JSON.stringify({ engine, owner, rc, err });
  const NGINX = { ID: 'abc', Names: 'nginx', Image: 'nginx:latest', State: 'running', Status: 'Up 1 hour' };

  it('no engine at all (exit 127) → dockerAvailable:false, nothing else (AC6)', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 127, stdout: '', stderr: 'bash: docker: command not found' });
    const result = await svc.getContainers(list[0]!.id);
    expect(result).toEqual({ dockerAvailable: false, sudoFailed: false, engines: [], containers: [] });
  });

  it('returns per-engine status + tagged containers (docker + podman + rootless podman of another user)', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({
      exitCode: 0,
      stdout: [
        wrap('docker', 'root', NGINX), status('docker', 'root', 0),
        status('podman', 'root', 0),
        wrap('podman', 'conexd', { Id: 'cafe', Names: ['conex-postgres'], Image: 'x', State: 'running', Status: 'healthy' }),
        status('podman', 'conexd', 0),
      ].join('\n'),
      stderr: '',
    });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.dockerAvailable).toBe(true);
    expect(result.sudoFailed).toBe(false);
    expect(result.engines).toHaveLength(3);
    expect(result.containers.map((c) => [c.name, c.engine, c.owner])).toEqual([
      ['nginx', 'docker', 'root'],
      ['conex-postgres', 'podman', 'conexd'],
    ]);
    expect(noopLogger.warn).not.toHaveBeenCalled();
  });

  it('engine present but socket denied → 200 with that engine flagged, no 500 (conex nodes)', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({
      exitCode: 0,
      stdout: status('docker', 'conex', 1, 'permission denied while trying to connect to the Docker daemon socket'),
      stderr: '',
    });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.dockerAvailable).toBe(true);
    expect(result.engines).toEqual([{ engine: 'docker', owner: 'conex', ok: false, permissionDenied: true }]);
    expect(result.containers).toEqual([]);
  });

  it('runs the script unelevated (bash -c, no stdin) when the node has no sudo password', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    await svc.getContainers(list[0]!.id);
    const [, cmd, , opts] = mockSshExec.mock.calls[0]!;
    expect(cmd.startsWith("bash -c '")).toBe(true);
    expect(cmd.startsWith('sudo')).toBe(false);
    expect(opts?.input).toBeUndefined();
  });

  it('elevates with sudo -S and sends the decrypted password on stdin when the node has one', async () => {
    const svc = makeService();
    const list = await svc.add({ ...NODE_INPUT, user: 'mike', sudoPassword: '110084' });
    mockSshExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    await svc.getContainers(list[0]!.id);
    const [, cmd, , opts] = mockSshExec.mock.calls[0]!;
    expect(cmd.startsWith(`sudo -S -k -p "" bash -c '`)).toBe(true);
    expect(cmd).not.toContain('110084');
    expect(opts?.input).toBe('110084\n');
  });

  it('sudo rejected the password → 200 { sudoFailed: true }, not a 500', async () => {
    const svc = makeService();
    const list = await svc.add({ ...NODE_INPUT, user: 'mike', sudoPassword: 'wrong' });
    mockSshExec.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Sorry, try again.\nsudo: 1 incorrect password attempt' });
    const result = await svc.getContainers(list[0]!.id);
    expect(result).toEqual({ dockerAvailable: true, sudoFailed: true, engines: [], containers: [] });
  });

  it('other non-zero exit still → NODES_COMMAND_FAILED 500', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'bash: syntax error' });
    await expect(svc.getContainers(list[0]!.id)).rejects.toMatchObject({
      response: { code: 'NODES_COMMAND_FAILED' },
    });
  });

  it('logs first bad line truncated + one aggregate warn for remaining bad lines (FOLLOWUP-3)', async () => {
    // (bad lines are anything that is not a wrapped container / status JSON line)
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    // 3 bad lines: first is a 500-char garbage string (should be truncated to 200),
    // the other two trigger only an aggregate count warn.
    const bigBadLine = 'B'.repeat(500);
    mockSshExec.mockResolvedValueOnce({
      exitCode: 0,
      stdout: `${bigBadLine}\nnot-json-2\nnot-json-3`,
      stderr: '',
    });
    vi.clearAllMocks();
    await svc.getContainers(list[0]!.id);
    // First warn: first bad line, truncated
    const firstCall = noopLogger.warn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof firstCall['line']).toBe('string');
    expect((firstCall['line'] as string).length).toBeLessThanOrEqual(200);
    // Second warn: aggregate count of remaining bad lines (2)
    const secondCall = noopLogger.warn.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(secondCall['count']).toBe(2);
    // Exactly 2 warn calls total (not one per bad line)
    expect(noopLogger.warn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// getMetrics — df partial failure tolerance (FIX-5)
// ---------------------------------------------------------------------------

// Minimal but valid METRICS_CMD stdout: two /proc/stat snapshots + supporting sections.
const STAT = `cpu  100 0 50 800 10 0 5 0 0 0\n`;
const LOADAVG = `0.1 0.2 0.3 1/100 999\n`;
const MEMINFO = `MemTotal: 8192000 kB\nMemFree: 0 kB\nMemAvailable: 4096000 kB\n`;
const UPTIME = `3600.0 7200.0\n`;
const DF_VALID = `Filesystem  Type  1B-blocks  Used  Available  Use%  Mounted on\n/dev/sda1   xfs   10000000   5000000   5000000   50%  /\n`;
const METRICS_STDOUT = [STAT, LOADAVG, MEMINFO, UPTIME, STAT, DF_VALID].join('\n__DINO__\n');

describe('NodesService.getMetrics', () => {
  it('returns metrics on exit 0', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 0, stdout: METRICS_STDOUT, stderr: '' });
    const m = await svc.getMetrics(list[0]!.id);
    expect(m.mem.total).toBeGreaterThan(0);
    expect(m.disks.length).toBeGreaterThan(0);
  });

  it('tolerates df exit 1 when stdout still has valid rows (FIX-5)', async () => {
    // GNU df exits 1 on stale NFS / dead FUSE but prints valid rows for healthy
    // filesystems. The whole node must not report 500 when disk data is present.
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({
      exitCode: 1,
      stdout: METRICS_STDOUT,
      stderr: 'df: /mnt/nfs: Stale file handle',
    });
    const m = await svc.getMetrics(list[0]!.id);
    expect(m.mem.total).toBeGreaterThan(0);
    expect(m.disks.length).toBeGreaterThan(0);
    expect(m.disks[0]?.mount).toBe('/');
  });

  it('throws NODES_COMMAND_FAILED when exit is non-zero and stdout has no usable data', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'some error' });
    const err = await svc.getMetrics(list[0]!.id).catch((e) => e) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect((err.getResponse() as Record<string, unknown>)['code']).toBe('NODES_COMMAND_FAILED');
  });
});

// ---------------------------------------------------------------------------
// KV persistence round-trip (AC2)
// ---------------------------------------------------------------------------

describe('KV persistence', () => {
  it('node added remains in list after re-reading', async () => {
    const svc = makeService();
    await svc.add(NODE_INPUT);
    const list = await svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.host).toBe('192.168.199.235');
  });
});
