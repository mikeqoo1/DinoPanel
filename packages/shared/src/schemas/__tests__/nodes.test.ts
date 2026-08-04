import { describe, it, expect } from 'vitest';
import {
  createNodeSchema,
  remoteNodeMetricsSchema,
  remoteContainersResponseSchema,
} from '../nodes';

describe('createNodeSchema — trust-boundary validation', () => {
  it('accepts valid input and defaults port to 22', () => {
    const result = createNodeSchema.safeParse({
      name: 'rocky-235',
      host: '192.168.199.235',
      user: 'root',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(22);
    }
  });

  it('accepts explicit port', () => {
    const result = createNodeSchema.safeParse({
      name: 'my-node',
      host: 'server.example.com',
      user: 'deploy_user',
      port: 2222,
    });
    expect(result.success).toBe(true);
  });

  it('rejects host starting with "-" (SSH option injection guard)', () => {
    for (const host of ['-oProxyCommand=x', '--rm', '-fN']) {
      expect(createNodeSchema.safeParse({ name: 'n', host, user: 'root' }).success).toBe(false);
    }
  });

  it('rejects user with shell-special characters', () => {
    for (const user of ['a;b', 'root$', 'foo bar', 'UPPER', 'a@b']) {
      expect(createNodeSchema.safeParse({ name: 'n', host: '127.0.0.1', user }).success).toBe(false);
    }
  });

  it('rejects port 0 and out-of-range ports', () => {
    for (const port of [0, -1, 65536, 100000]) {
      expect(createNodeSchema.safeParse({ name: 'n', host: '127.0.0.1', user: 'root', port }).success).toBe(false);
    }
  });

  it('rejects empty name and name over 64 chars', () => {
    expect(createNodeSchema.safeParse({ name: '', host: '127.0.0.1', user: 'root' }).success).toBe(false);
    expect(createNodeSchema.safeParse({ name: 'a'.repeat(65), host: '127.0.0.1', user: 'root' }).success).toBe(false);
  });
});

describe('remoteNodeMetricsSchema — happy-path parse', () => {
  it('parses a valid metrics payload', () => {
    const result = remoteNodeMetricsSchema.safeParse({
      ts: Date.now(),
      cpu: { usage: 12.5, loadAvg: [0.5, 0.8, 1.2] },
      mem: { used: 1_000_000_000, total: 4_000_000_000, free: 3_000_000_000 },
      disks: [
        { mount: '/', fstype: 'xfs', used: 5_000_000_000, total: 50_000_000_000 },
        { mount: '/boot', fstype: 'vfat', used: 100_000_000, total: 500_000_000 },
      ],
      uptimeSec: 86400,
    });
    expect(result.success).toBe(true);
  });
});

describe('remoteContainersResponseSchema — happy-path parse', () => {
  it('parses dockerAvailable:true with containers', () => {
    const result = remoteContainersResponseSchema.safeParse({
      dockerAvailable: true,
      containers: [
        { id: 'abc123', name: 'nginx', image: 'nginx:latest', state: 'running', status: 'Up 2 hours' },
        { id: 'def456', name: 'db', image: 'postgres:15', state: 'exited', status: 'Exited (0) 1 day ago' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('parses dockerAvailable:false with empty containers', () => {
    const result = remoteContainersResponseSchema.safeParse({
      dockerAvailable: false,
      containers: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown container state', () => {
    const result = remoteContainersResponseSchema.safeParse({
      dockerAvailable: true,
      containers: [
        { id: 'x', name: 'x', image: 'x', state: 'unknown_state', status: 'x' },
      ],
    });
    expect(result.success).toBe(false);
  });
});
