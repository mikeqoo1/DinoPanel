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

function makeService(initialJson?: string) {
  return new NodesService(makeDb(initialJson) as never, noopLogger as never);
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
// getContainers — docker absent detection (AC6)
// ---------------------------------------------------------------------------

describe('NodesService.getContainers', () => {
  it('returns { dockerAvailable: false } for exit 127 (AC6)', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({
      exitCode: 127,
      stdout: '',
      stderr: 'bash: docker: command not found',
    });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.dockerAvailable).toBe(false);
    expect(result.containers).toEqual([]);
  });

  it('returns { dockerAvailable: false } for non-zero exit + docker-specific not-found in stderr (AC6)', async () => {
    // Must NOT trigger on unrelated "command not found" from ~/.bashrc noise on a
    // successful (exit 0) docker ps — only on docker-specific stderr with non-zero exit.
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'bash: docker: command not found',
    });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.dockerAvailable).toBe(false);
  });

  it('does NOT return dockerAvailable:false when exit is 0 despite unrelated "command not found" in stderr', async () => {
    // Unrelated ~/.bashrc noise like "foo: command not found" on a SUCCESSFUL docker ps
    // must not mask real container data.
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    const line = JSON.stringify({
      ID: 'abc',
      Names: 'nginx',
      Image: 'nginx:latest',
      State: 'running',
      Status: 'Up 1 hour',
    });
    mockSshExec.mockResolvedValueOnce({
      exitCode: 0,
      stdout: line,
      stderr: 'foo: command not found',
    });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.dockerAvailable).toBe(true);
    expect(result.containers).toHaveLength(1);
  });

  it('reads the engine marker line and reports engine=docker without treating it as a container', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    const line = JSON.stringify({ ID: 'abc', Names: 'nginx', Image: 'nginx:latest', State: 'running', Status: 'Up 1 hour' });
    mockSshExec.mockResolvedValueOnce({ exitCode: 0, stdout: `__DINO_ENGINE__=docker\n${line}\n`, stderr: '' });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.engine).toBe('docker');
    expect(result.permissionDenied).toBe(false);
    expect(result.containers).toHaveLength(1);
    expect(noopLogger.warn).not.toHaveBeenCalled();
  });

  it('reports engine=podman when the podman branch ran', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    const line = JSON.stringify({ Id: 'cafe', Names: ['gitlab-runner'], Image: 'x', State: 'running', Status: '' });
    mockSshExec.mockResolvedValueOnce({ exitCode: 0, stdout: `__DINO_ENGINE__=podman\n${line}`, stderr: '' });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.engine).toBe('podman');
    expect(result.containers[0]?.name).toBe('gitlab-runner');
  });

  it('engine is null when no marker line is present (older remote command output)', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.engine).toBeNull();
    expect(result.dockerAvailable).toBe(true);
  });

  it('engine present but socket permission denied → 200 with permissionDenied:true, not a 500', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '__DINO_ENGINE__=docker\n',
      stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock',
    });
    const result = await svc.getContainers(list[0]!.id);
    expect(result).toEqual({ dockerAvailable: true, engine: 'docker', permissionDenied: true, containers: [] });
    expect(noopLogger.warn).not.toHaveBeenCalled();
  });

  it('engine absent → engine null and permissionDenied false', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({ exitCode: 127, stdout: '', stderr: '' });
    const result = await svc.getContainers(list[0]!.id);
    expect(result).toEqual({ dockerAvailable: false, engine: null, permissionDenied: false, containers: [] });
  });

  it('parses docker ps JSON lines on exit 0', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    const line = JSON.stringify({
      ID: 'abc',
      Names: 'nginx',
      Image: 'nginx:latest',
      State: 'running',
      Status: 'Up 1 hour',
    });
    mockSshExec.mockResolvedValueOnce({ exitCode: 0, stdout: line, stderr: '' });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.dockerAvailable).toBe(true);
    expect(result.containers).toHaveLength(1);
    expect(result.containers[0]?.state).toBe('running');
  });

  it('logs first bad line truncated + one aggregate warn for remaining bad lines (FOLLOWUP-3)', async () => {
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
