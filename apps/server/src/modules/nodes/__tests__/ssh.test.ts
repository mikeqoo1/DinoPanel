import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import {
  buildSshArgs,
  classifySshFailure,
  sshExec,
  METRICS_CMD,
  DOCKER_PS_CMD,
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
  it('produces args in exact spec order with -- before remoteCmd', () => {
    const args = buildSshArgs(FAKE_NODE, 'true');
    expect(args).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-p', '22',
      'root@192.168.1.100',
      '--',
      'true',
    ]);
  });

  it('uses the node port in -p', () => {
    const node = { ...FAKE_NODE, port: 2222 };
    const args = buildSshArgs(node, 'true');
    const pIdx = args.indexOf('-p');
    expect(args[pIdx + 1]).toBe('2222');
  });

  it('places -- before remoteCmd (injection guard layer 2)', () => {
    const args = buildSshArgs(FAKE_NODE, 'any-remote-cmd');
    const dashIdx = args.indexOf('--');
    expect(dashIdx).toBeGreaterThan(0);
    expect(args[dashIdx + 1]).toBe('any-remote-cmd');
  });

  it('METRICS_CMD starts with export LC_ALL=C;', () => {
    expect(METRICS_CMD.startsWith('export LC_ALL=C;')).toBe(true);
  });

  it('DOCKER_PS_CMD starts with export LC_ALL=C;', () => {
    expect(DOCKER_PS_CMD.startsWith('export LC_ALL=C;')).toBe(true);
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
});
