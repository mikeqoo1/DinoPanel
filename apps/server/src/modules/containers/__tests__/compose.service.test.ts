import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { ComposeService } from '../compose.service';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Mock child_process used by ComposeService
vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return { ...orig, execFile: vi.fn(), spawn: vi.fn() };
});

// Mock promisify so execFileAsync resolves/rejects based on the mock
vi.mock('node:util', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return { ...orig, promisify: (fn: unknown) => fn };
});

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
}));

import * as cp from 'node:child_process';
import * as fsp from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeDockerMock(containerList: object[] = []) {
  return {
    listContainers: vi.fn().mockResolvedValue(containerList),
  };
}

function makeDbMock() {
  return {
    _rows: [] as Array<{ id: number; name: string; path: string; createdAt: Date }>,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(function (this: ReturnType<typeof makeDbMock>) {
      return Promise.resolve(this._rows);
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    delete: vi.fn().mockReturnThis(),
  };
}

/** Build a ComposeService with mocked dependencies; skip onModuleInit v2 check */
function makeService(
  docker = makeDockerMock(),
  db = makeDbMock(),
  v2Available = true,
) {
  const logger = makeLogger();
  const svc = new ComposeService(docker as never, db as never, logger as never);
  // Force the v2 flag without actually running the subprocess
  (svc as unknown as { isV2Available: boolean }).isV2Available = v2Available;
  return { svc, docker, db, logger };
}

/** Build a mock ChildProcess that emits events on next tick */
function makeMockChild(
  stdout: string,
  stderr: string,
  exitCode: number,
): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  // Emit data and close on next tick so callers can attach listeners first
  setImmediate(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });

  return child;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const LABEL_CONTAINER_PLANE = {
  Id: 'aaa111',
  Names: ['/plane-web'],
  Image: 'makeplane/plane-frontend:latest',
  ImageID: 'sha256:abc',
  State: 'running',
  Status: 'Up 3 hours',
  Ports: [],
  Labels: {
    'com.docker.compose.project': 'plane-app',
    'com.docker.compose.working_dir': '/srv/plane',
    'com.docker.compose.service': 'web',
  },
  Created: 1700000000,
};

const LABEL_CONTAINER_NGINX = {
  Id: 'bbb222',
  Names: ['/nginx-proxy'],
  Image: 'nginx:latest',
  ImageID: 'sha256:def',
  State: 'exited',
  Status: 'Exited (0) 1 hour ago',
  Ports: [],
  Labels: {
    'com.docker.compose.project': 'nginx-test',
    'com.docker.compose.working_dir': '/home/user/nginx-test',
    'com.docker.compose.service': 'proxy',
  },
  Created: 1700001000,
};

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('ComposeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CS-1. listStacks() happy path — merges discovered + registered, deduplicates
  it('CS-1 — listStacks() merges discovered and registered stacks without duplicates', async () => {
    const docker = makeDockerMock([LABEL_CONTAINER_PLANE, LABEL_CONTAINER_NGINX]);
    const db = makeDbMock();
    // plane-app is registered in DB
    db._rows = [{ id: 1, name: 'plane-app', path: '/srv/plane', createdAt: new Date() }];
    db.from.mockReturnThis();
    db.select.mockReturnThis();
    db.where.mockReturnThis();
    db.limit.mockResolvedValue(db._rows);

    // db.select().from(composeStacks) — make from() resolve with _rows
    db.from.mockImplementation(function (this: ReturnType<typeof makeDbMock>) {
      // Return a thenable that resolves to _rows
      return {
        ...this,
        then: (resolve: (v: typeof db._rows) => void) => resolve(db._rows),
        [Symbol.iterator]: undefined,
      };
    });

    const { svc } = makeService(docker, db);

    const result = await svc.listStacks();

    // Should have exactly 2 stacks (plane-app registered + nginx-test discovered)
    expect(result).toHaveLength(2);

    const planeStack = result.find((s) => s.name === 'plane-app');
    const nginxStack = result.find((s) => s.name === 'nginx-test');

    expect(planeStack).toBeDefined();
    expect(planeStack!.source).toBe('registered');
    expect(planeStack!.id).toBe(1);
    expect(planeStack!.runningCount).toBe(1);

    expect(nginxStack).toBeDefined();
    expect(nginxStack!.source).toBe('discovered');
    expect(nginxStack!.id).toBeNull();
    expect(nginxStack!.runningCount).toBe(0);
  });

  // CS-2. createStack() happy path — writes file, inserts DB, returns ComposeStack
  it('CS-2 — createStack() writes compose file, inserts DB row, returns registered ComposeStack', async () => {
    const docker = makeDockerMock([]);
    const db = makeDbMock();
    db._rows = []; // no existing row for name conflict check
    db.limit.mockResolvedValue([]);
    db.returning.mockResolvedValue([{ id: 42, name: 'mystack', path: '/home/user/dinopanel-stacks/mystack', createdAt: new Date() }]);

    const mkdirMock = vi.mocked(fsp.mkdir);
    const writeFileMock = vi.mocked(fsp.writeFile);

    const { svc } = makeService(docker, db);

    const result = await svc.createStack({
      name: 'mystack',
      path: '/home/user/dinopanel-stacks/mystack',
      content: 'services:\n  web:\n    image: nginx',
    });

    expect(mkdirMock).toHaveBeenCalledWith('/home/user/dinopanel-stacks/mystack', { recursive: true });
    expect(writeFileMock).toHaveBeenCalledWith(
      '/home/user/dinopanel-stacks/mystack/compose.yml',
      'services:\n  web:\n    image: nginx',
      'utf8',
    );

    expect(result.id).toBe(42);
    expect(result.name).toBe('mystack');
    expect(result.source).toBe('registered');
    expect(result.containerCount).toBe(0);
  });

  // CS-3. createStack() with already-existing name → ConflictException
  it('CS-3 — createStack() with duplicate name throws ConflictException', async () => {
    const db = makeDbMock();
    // Simulate existing row found
    db.limit.mockResolvedValue([{ id: 1, name: 'mystack', path: '/some/path', createdAt: new Date() }]);

    const { svc } = makeService(makeDockerMock([]), db);

    await expect(
      svc.createStack({ name: 'mystack', path: '/home/user/dinopanel-stacks/mystack' }),
    ).rejects.toThrow(ConflictException);

    await expect(
      svc.createStack({ name: 'mystack', path: '/home/user/dinopanel-stacks/mystack' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'COMPOSE_NAME_CONFLICT' }),
    });
  });

  // CS-4. validate() with exit code 0 → { valid: true, resolvedYaml }
  it('CS-4 — validate() when docker compose config exits 0 returns valid:true with resolvedYaml', async () => {
    const docker = makeDockerMock([]);
    const db = makeDbMock();

    // getStack internally calls listStacks → listContainers returns empty, DB returns one row
    db._rows = [{ id: 5, name: 'teststack', path: '/srv/teststack', createdAt: new Date() }];
    db.from.mockImplementation(function (this: ReturnType<typeof makeDbMock>) {
      return {
        ...this,
        then: (resolve: (v: typeof db._rows) => void) => resolve(db._rows),
      };
    });

    // stat() resolves so readComposeFile finds the file
    vi.mocked(fsp.stat).mockResolvedValue({ isFile: () => true } as never);

    const resolvedYaml = 'services:\n  web:\n    image: nginx:latest\n';
    const mockChild = makeMockChild(resolvedYaml, '', 0);
    vi.mocked(cp.spawn).mockReturnValue(mockChild as never);

    const { svc } = makeService(docker, db);

    const result = await svc.validate('5');

    expect(result.valid).toBe(true);
    expect(result.resolvedYaml).toBe(resolvedYaml);
    expect(result.errors).toBeUndefined();
  });

  // CS-6. readComposeFile() on a stack with empty path → 409 COMPOSE_FILE_UNAVAILABLE
  it('CS-6 — readComposeFile() throws COMPOSE_FILE_UNAVAILABLE for a discovered stack with no path', async () => {
    // plane-app appears only via discovery; the working_dir label is missing,
    // so stack.path is "". The service must short-circuit before any fs call.
    const docker = makeDockerMock([
      { ...LABEL_CONTAINER_PLANE, Labels: { ...LABEL_CONTAINER_PLANE.Labels, 'com.docker.compose.working_dir': '' } },
    ]);
    const db = makeDbMock();
    db._rows = [];
    db.from.mockImplementation(function (this: ReturnType<typeof makeDbMock>) {
      return {
        ...this,
        then: (resolve: (v: typeof db._rows) => void) => resolve(db._rows),
      };
    });

    const { svc } = makeService(docker, db);

    await expect(svc.readComposeFile('plane-app')).rejects.toThrow(ConflictException);
    await expect(svc.readComposeFile('plane-app')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'COMPOSE_FILE_UNAVAILABLE' }),
    });

    // Critical: fs must NOT have been hit — the short-circuit must fire first
    expect(vi.mocked(fsp.stat)).not.toHaveBeenCalled();
    expect(vi.mocked(fsp.readFile)).not.toHaveBeenCalled();
  });

  // CS-7. validate() on a stack with empty path → 409, no docker compose spawn
  it('CS-7 — validate() throws COMPOSE_FILE_UNAVAILABLE for a discovered stack with no path', async () => {
    const docker = makeDockerMock([
      { ...LABEL_CONTAINER_PLANE, Labels: { ...LABEL_CONTAINER_PLANE.Labels, 'com.docker.compose.working_dir': '' } },
    ]);
    const db = makeDbMock();
    db._rows = [];
    db.from.mockImplementation(function (this: ReturnType<typeof makeDbMock>) {
      return {
        ...this,
        then: (resolve: (v: typeof db._rows) => void) => resolve(db._rows),
      };
    });

    const { svc } = makeService(docker, db);

    await expect(svc.validate('plane-app')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'COMPOSE_FILE_UNAVAILABLE' }),
    });

    // Must not leak through to `docker compose config`
    expect(vi.mocked(cp.spawn)).not.toHaveBeenCalled();
  });

  // CS-5. validate() with exit code 1 and stderr → { valid: false, errors[] }
  it('CS-5 — validate() when docker compose config exits 1 returns valid:false with parsed errors', async () => {
    const docker = makeDockerMock([]);
    const db = makeDbMock();

    db._rows = [{ id: 5, name: 'teststack', path: '/srv/teststack', createdAt: new Date() }];
    db.from.mockImplementation(function (this: ReturnType<typeof makeDbMock>) {
      return {
        ...this,
        then: (resolve: (v: typeof db._rows) => void) => resolve(db._rows),
      };
    });

    vi.mocked(fsp.stat).mockResolvedValue({ isFile: () => true } as never);

    const stderrOutput =
      'validating /srv/teststack/compose.yml: (root): services is required\nline 5: invalid key "servces"';
    const mockChild = makeMockChild('', stderrOutput, 1);
    vi.mocked(cp.spawn).mockReturnValue(mockChild as never);

    const { svc } = makeService(docker, db);

    const result = await svc.validate('5');

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors!.some((e) => e.message.includes('services is required'))).toBe(true);
  });
});
