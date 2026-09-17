import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import {
  buildSshArgs,
  classifySshFailure,
  isDockerAbsent,
  isEnginePermissionDenied,
  sshExec,
  METRICS_CMD,
  CONTAINER_PS_CMD,
  ENGINE_MARKER,
} from '../ssh';
import { runCommand, CommandError } from '../../../common/shell/run-command';
import type * as RunCommandModule from '../../../common/shell/run-command';

// Keep real CommandError + commandErrorToHttp; only mock runCommand
vi.mock('../../../common/shell/run-command', async (importOriginal) => {
  const actual = await importOriginal<typeof RunCommandModule>();
  return { ...actual, runCommand: vi.fn() };
});

const mockRunCommand = vi.mocked(runCommand);

const FAKE_NODE = { id: 'n1', name: 'rocky', host: '192.168.1.100', port: 22, user: 'root' };
const noopLogger = { warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// buildSshArgs — golden test (AC11)
// ---------------------------------------------------------------------------

describe('buildSshArgs', () => {
  it('produces args in exact spec order with -- BEFORE the destination (AC11, security)', () => {
    // `--` must precede the hostname, not follow it. OpenSSH parses left-to-right:
    // after `--`, the next token is the hostname. If `--` comes after the hostname,
    // an option-shaped hostname (e.g. `-oProxyCommand=…`) is parsed as an option
    // and EXECUTED — confirmed on OpenSSH_9.6p1. HOST_REGEX is layer 1; `--` is layer 2.
    const args = buildSshArgs(FAKE_NODE, 'true');
    expect(args).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-p', '22',
      '--',
      'root@192.168.1.100',
      'true',
    ]);
  });

  it('uses the node port in -p', () => {
    const node = { ...FAKE_NODE, port: 2222 };
    const args = buildSshArgs(node, 'true');
    const pIdx = args.indexOf('-p');
    expect(args[pIdx + 1]).toBe('2222');
  });

  it('-- comes before the destination (not after) — prevents option-shaped hostname execution', () => {
    // SSH parses `ssh [options] -- destination [command]`, not
    // `ssh [options] destination -- command`. The destination must follow `--`.
    const args = buildSshArgs(FAKE_NODE, 'any-remote-cmd');
    const dashIdx = args.indexOf('--');
    expect(dashIdx).toBeGreaterThan(0);
    // destination is immediately after `--`
    expect(args[dashIdx + 1]).toBe('root@192.168.1.100');
    // remote command is immediately after destination
    expect(args[dashIdx + 2]).toBe('any-remote-cmd');
  });

  it('METRICS_CMD starts with export LC_ALL=C;', () => {
    expect(METRICS_CMD.startsWith('export LC_ALL=C;')).toBe(true);
  });

  it('CONTAINER_PS_CMD starts with export LC_ALL=C;', () => {
    expect(CONTAINER_PS_CMD.startsWith('export LC_ALL=C;')).toBe(true);
  });

  it('CONTAINER_PS_CMD tries docker ps first, then falls back to podman ps', () => {
    const docker = CONTAINER_PS_CMD.indexOf("docker ps -a --format '{{json .}}'");
    const podman = CONTAINER_PS_CMD.indexOf("podman ps -a --format '{{json .}}'");
    expect(docker).toBeGreaterThan(-1);
    expect(podman).toBeGreaterThan(docker);
  });

  it('CONTAINER_PS_CMD announces the engine on its own line before the ps output', () => {
    expect(ENGINE_MARKER).toBe('__DINO_ENGINE__=');
    const dockerMark = CONTAINER_PS_CMD.indexOf(`echo ${ENGINE_MARKER}docker;`);
    const dockerPs = CONTAINER_PS_CMD.indexOf('docker ps -a');
    const podmanMark = CONTAINER_PS_CMD.indexOf(`echo ${ENGINE_MARKER}podman;`);
    const podmanPs = CONTAINER_PS_CMD.indexOf('podman ps -a');
    expect(dockerMark).toBeGreaterThan(-1);
    expect(dockerMark).toBeLessThan(dockerPs);
    expect(podmanMark).toBeGreaterThan(-1);
    expect(podmanMark).toBeLessThan(podmanPs);
  });

  it('CONTAINER_PS_CMD exits 127 when neither engine is installed', () => {
    expect(CONTAINER_PS_CMD).toMatch(/exit 127/);
  });

  it('CONTAINER_PS_CMD contains no mutation verbs (read-only guarantee, AC7)', () => {
    expect(CONTAINER_PS_CMD).not.toMatch(/(docker|podman) (start|stop|restart|rm|exec|run|kill|pull)/);
  });
});

// ---------------------------------------------------------------------------
// classifySshFailure — all branches (AC9)
// ---------------------------------------------------------------------------

describe('classifySshFailure', () => {
  it('null exitCode → NODES_TIMEOUT 504', () => {
    const r = classifySshFailure(null, '');
    expect(r.code).toBe('NODES_TIMEOUT');
    expect(r.status).toBe(504);
  });

  it('exit 255 + "Connection refused" → NODES_UNREACHABLE 502', () => {
    const r = classifySshFailure(255, 'ssh: connect to host 192.168.1.100 port 22: Connection refused');
    expect(r.code).toBe('NODES_UNREACHABLE');
    expect(r.status).toBe(502);
  });

  it('exit 255 + "No route to host" → NODES_UNREACHABLE 502', () => {
    const r = classifySshFailure(255, 'ssh: connect to host 192.0.2.1 port 22: No route to host');
    expect(r.code).toBe('NODES_UNREACHABLE');
    expect(r.status).toBe(502);
  });

  it('exit 255 + "Permission denied (publickey)" → NODES_AUTH_FAILED 502', () => {
    const r = classifySshFailure(255, 'root@192.168.1.100: Permission denied (publickey).');
    expect(r.code).toBe('NODES_AUTH_FAILED');
    expect(r.status).toBe(502);
  });

  it('exit 255 + "bad permissions" → NODES_AUTH_FAILED 502', () => {
    const r = classifySshFailure(255, 'WARNING: UNPROTECTED PRIVATE KEY FILE!\nbad permissions: ignore key');
    expect(r.code).toBe('NODES_AUTH_FAILED');
    expect(r.status).toBe(502);
  });

  it('exit 255 + "REMOTE HOST IDENTIFICATION HAS CHANGED" → NODES_HOSTKEY_CHANGED 502 with known_hosts hint', () => {
    const r = classifySshFailure(
      255,
      '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
    );
    expect(r.code).toBe('NODES_HOSTKEY_CHANGED');
    expect(r.status).toBe(502);
    expect(r.message).toContain('known_hosts');
  });

  it('exit 255 + "Host key verification failed" → NODES_HOSTKEY_CHANGED 502', () => {
    const r = classifySshFailure(255, 'Host key verification failed.');
    expect(r.code).toBe('NODES_HOSTKEY_CHANGED');
    expect(r.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// sshExec — error cases, stderr-not-leaked assertions (AC9, AC10)
// ---------------------------------------------------------------------------

describe('sshExec', () => {
  it('throws 503 NODES_TOOL_MISSING when ssh binary is absent', async () => {
    mockRunCommand.mockRejectedValue(new CommandError('TOOL_MISSING', 'ssh: not installed'));
    const err = await sshExec(FAKE_NODE, 'true', noopLogger).catch((e) => e) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    const body = err.getResponse() as Record<string, unknown>;
    expect(body['code']).toBe('NODES_TOOL_MISSING');
    expect(err.getStatus()).toBe(503);
  });

  it('throws 504 NODES_TIMEOUT for null exitCode; stderr not in response (AC10)', async () => {
    const SECRET = 'SUPER_SECRET_TIMEOUT_STDERR';
    mockRunCommand.mockResolvedValue({ exitCode: null, stdout: '', stderr: SECRET });
    const err = await sshExec(FAKE_NODE, 'true', noopLogger).catch((e) => e) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(504);
    const body = err.getResponse() as Record<string, unknown>;
    expect(body['code']).toBe('NODES_TIMEOUT');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('throws 502 NODES_UNREACHABLE for exit 255+Connection refused; stderr not in response (AC10)', async () => {
    const SECRET = 'UNIQUE_REFUSED_STDERR_XYZ123';
    mockRunCommand.mockResolvedValue({
      exitCode: 255,
      stdout: '',
      stderr: `ssh: connect to host x port 22: Connection refused\n${SECRET}`,
    });
    const err = await sshExec(FAKE_NODE, 'true', noopLogger).catch((e) => e) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(502);
    const body = err.getResponse() as Record<string, unknown>;
    expect(body['code']).toBe('NODES_UNREACHABLE');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('throws 502 NODES_AUTH_FAILED for exit 255+Permission denied; stderr not in response', async () => {
    const SECRET = 'UNIQUE_AUTH_STDERR_ABC';
    mockRunCommand.mockResolvedValue({
      exitCode: 255,
      stdout: '',
      stderr: `Permission denied (publickey).\n${SECRET}`,
    });
    const err = await sshExec(FAKE_NODE, 'true', noopLogger).catch((e) => e) as HttpException;
    const body = err.getResponse() as Record<string, unknown>;
    expect(body['code']).toBe('NODES_AUTH_FAILED');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('throws 502 NODES_HOSTKEY_CHANGED for exit 255+host key changed, message has known_hosts hint', async () => {
    mockRunCommand.mockResolvedValue({
      exitCode: 255,
      stdout: '',
      stderr: 'REMOTE HOST IDENTIFICATION HAS CHANGED',
    });
    const err = await sshExec(FAKE_NODE, 'true', noopLogger).catch((e) => e) as HttpException;
    const body = err.getResponse() as Record<string, unknown>;
    expect(body['code']).toBe('NODES_HOSTKEY_CHANGED');
    expect(String(body['message'])).toContain('known_hosts');
  });

  it('returns CommandResult for exit 0', async () => {
    mockRunCommand.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    const result = await sshExec(FAKE_NODE, 'true', noopLogger);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  it('returns CommandResult for exit 127 (service handles docker-absent)', async () => {
    mockRunCommand.mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr: 'bash: docker: command not found',
    });
    const result = await sshExec(FAKE_NODE, 'docker ps', noopLogger);
    expect(result.exitCode).toBe(127);
  });

  // FOLLOWUP-1: stderr truncation before logging
  it('truncates large stderr to ≤2048 chars in nodes.ssh_failure warn (FOLLOWUP-1)', async () => {
    const bigStderr = 'x'.repeat(8192);
    mockRunCommand.mockResolvedValue({ exitCode: 255, stdout: '', stderr: bigStderr });
    await sshExec(FAKE_NODE, 'true', noopLogger).catch(() => {});
    const loggedObj = noopLogger.warn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof loggedObj['stderr']).toBe('string');
    expect((loggedObj['stderr'] as string).length).toBeLessThanOrEqual(2048);
  });

  it('truncates large stderr to ≤2048 chars in nodes.ssh_command_error warn (FOLLOWUP-1)', async () => {
    const bigStderr = 'y'.repeat(8192);
    mockRunCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: bigStderr });
    await sshExec(FAKE_NODE, 'true', noopLogger);
    const loggedObj = noopLogger.warn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof loggedObj['stderr']).toBe('string');
    expect((loggedObj['stderr'] as string).length).toBeLessThanOrEqual(2048);
  });

  it('does not warn for exit 1 + engine socket permission denied (expected node state)', async () => {
    const logger = { warn: vi.fn() };
    mockRunCommand.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock',
    });
    await sshExec(FAKE_NODE, 'cmd', logger);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not warn for exit 1 + docker-specific not-found (isDockerAbsent, FOLLOWUP-2)', async () => {
    mockRunCommand.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'bash: docker: command not found',
    });
    await sshExec(FAKE_NODE, 'docker ps', noopLogger);
    expect(noopLogger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// isDockerAbsent — predicate unit tests (FOLLOWUP-2)
// ---------------------------------------------------------------------------

describe('isDockerAbsent', () => {
  it('returns true for exit 127 regardless of stderr', () => {
    expect(isDockerAbsent({ exitCode: 127, stdout: '', stderr: '' })).toBe(true);
  });

  it('returns true for non-zero exit + "docker: command not found"', () => {
    expect(isDockerAbsent({ exitCode: 1, stdout: '', stderr: 'bash: docker: command not found' })).toBe(true);
  });

  it('returns true for non-zero exit + "docker: not found"', () => {
    expect(isDockerAbsent({ exitCode: 1, stdout: '', stderr: 'docker: not found' })).toBe(true);
  });

  it('returns true for non-zero exit + "podman: command not found"', () => {
    expect(isDockerAbsent({ exitCode: 1, stdout: '', stderr: 'bash: podman: command not found' })).toBe(true);
  });

  it('returns false for exit 0 even with "command not found" in stderr', () => {
    expect(isDockerAbsent({ exitCode: 0, stdout: '', stderr: 'foo: command not found' })).toBe(false);
  });

  it('returns false for non-zero exit + unrelated stderr', () => {
    expect(isDockerAbsent({ exitCode: 1, stdout: '', stderr: '/usr/bin/env: command not found' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEnginePermissionDenied — engine installed but the SSH user cannot use its socket
// ---------------------------------------------------------------------------

describe('isEnginePermissionDenied', () => {
  it('true for exit 1 + docker daemon socket permission denied', () => {
    expect(isEnginePermissionDenied({
      exitCode: 1, stdout: '',
      stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.51/containers/json?all=1": dial unix /var/run/docker.sock: connect: permission denied',
    })).toBe(true);
  });

  it('true for exit 125 + podman-style "permission denied"', () => {
    expect(isEnginePermissionDenied({
      exitCode: 125, stdout: '',
      stderr: 'Error: unable to connect to Podman socket: Get "http://d/v5.0.0/libpod/_ping": dial unix /run/podman/podman.sock: connect: permission denied',
    })).toBe(true);
  });

  it('false for exit 0 even if stderr mentions permission denied', () => {
    expect(isEnginePermissionDenied({ exitCode: 0, stdout: '', stderr: 'permission denied' })).toBe(false);
  });

  it('false for exit 127 (that is isDockerAbsent territory)', () => {
    expect(isEnginePermissionDenied({ exitCode: 127, stdout: '', stderr: 'permission denied' })).toBe(false);
  });

  it('false for non-zero exit with unrelated stderr', () => {
    expect(isEnginePermissionDenied({ exitCode: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon. Is the docker daemon running?' })).toBe(false);
  });
});
