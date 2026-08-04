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

  it('returns { dockerAvailable: false } when stderr contains "command not found" (AC6)', async () => {
    const svc = makeService();
    const list = await svc.add(NODE_INPUT);
    mockSshExec.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '/usr/bin/env: command not found',
    });
    const result = await svc.getContainers(list[0]!.id);
    expect(result.dockerAvailable).toBe(false);
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
