import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import {
  CommandError,
  assertSuccess,
  commandErrorToHttp,
  probeCommand,
  runCommand,
} from '../run-command';

const MISSING_BIN = '__dinopanel_nonexistent_binary__';

describe('runCommand', () => {
  it('rejects with CommandError TOOL_MISSING when the binary is absent', async () => {
    await expect(runCommand(MISSING_BIN, [])).rejects.toMatchObject({
      name: 'CommandError',
      kind: 'TOOL_MISSING',
    });
  });

  it('captures stdout + exit code for a command that runs', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("hi")']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hi');
  });
});

describe('assertSuccess', () => {
  it('returns silently on exit 0', () => {
    expect(() => assertSuccess({ exitCode: 0, stdout: '', stderr: '' }, 'op')).not.toThrow();
  });

  it('maps permission-denied stderr to PERMISSION_DENIED', () => {
    try {
      assertSuccess({ exitCode: 1, stdout: '', stderr: 'ufw: ERROR: permission denied' }, 'ufw');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CommandError);
      expect((err as CommandError).kind).toBe('PERMISSION_DENIED');
    }
  });

  it('maps any other non-zero exit to COMMAND_FAILED', () => {
    try {
      assertSuccess({ exitCode: 2, stdout: '', stderr: 'bad rule' }, 'ufw');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as CommandError).kind).toBe('COMMAND_FAILED');
    }
  });
});

describe('commandErrorToHttp', () => {
  it('maps TOOL_MISSING to a 503 with a prefixed code', () => {
    const http = commandErrorToHttp(new CommandError('TOOL_MISSING', 'x'), 'NTP');
    expect(http).toBeInstanceOf(HttpException);
    expect(http.getStatus()).toBe(503);
    expect(http.getResponse()).toMatchObject({ code: 'NTP_TOOL_MISSING' });
  });

  it('redacts host stderr from the client response by default (production posture)', () => {
    const http = commandErrorToHttp(new CommandError('COMMAND_FAILED', 'x', 'boom'), 'FIREWALL');
    expect(http.getStatus()).toBe(500);
    expect(http.getResponse()).toMatchObject({ code: 'FIREWALL_COMMAND_FAILED' });
    // stderr can leak host paths / config internals — never forwarded unless opted in.
    expect(http.getResponse()).not.toHaveProperty('details');
  });

  it('forwards stderr as details only when exposeStderr is set (development)', () => {
    const http = commandErrorToHttp(new CommandError('COMMAND_FAILED', 'x', 'boom'), 'FIREWALL', {
      exposeStderr: true,
    });
    expect(http.getStatus()).toBe(500);
    expect(http.getResponse()).toMatchObject({
      code: 'FIREWALL_COMMAND_FAILED',
      details: { stderr: 'boom' },
    });
  });
});

describe('probeCommand', () => {
  it('returns false for a missing binary (never throws)', async () => {
    await expect(probeCommand(MISSING_BIN, [])).resolves.toBe(false);
  });

  it('returns true when the command exits 0', async () => {
    await expect(probeCommand(process.execPath, ['-e', 'process.exit(0)'])).resolves.toBe(true);
  });

  it('returns false when the command exits non-zero', async () => {
    await expect(probeCommand(process.execPath, ['-e', 'process.exit(3)'])).resolves.toBe(false);
  });
});
