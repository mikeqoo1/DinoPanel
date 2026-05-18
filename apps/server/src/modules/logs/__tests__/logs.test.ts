import { describe, it, expect, vi } from 'vitest';
import { parseSystemLog } from '../readers/system-log.reader';
import { parseSshLog } from '../readers/ssh-log.reader';
import { OperationLogReader } from '../readers/operation-log.reader';
import { LoginLogReader } from '../readers/login-log.reader';
import { TaskLogReader } from '../readers/task-log.reader';

// ---------------------------------------------------------------------------
// System log parser
// ---------------------------------------------------------------------------

describe('parseSystemLog', () => {
  it('parses ISO-prefixed lines and falls back to now for malformed rows', () => {
    const input = [
      '2026-05-18T10:00:00+00:00 hostname[1234]: started service x',
      'malformed line without timestamp',
      '2026-05-18T10:05:42+00:00 kernel: [12345.678] something happened',
    ].join('\n');
    const out = parseSystemLog(input);
    expect(out).toHaveLength(3);
    expect(out[0]?.line).toContain('started service x');
    expect(out[0]?.ts).toBe(Date.parse('2026-05-18T10:00:00+00:00'));
    expect(out[1]?.line).toBe('malformed line without timestamp');
    expect(out[2]?.line).toContain('something happened');
  });

  it('returns empty array for empty input', () => {
    expect(parseSystemLog('')).toEqual([]);
    expect(parseSystemLog('   \n\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SSH log parser
// ---------------------------------------------------------------------------

describe('parseSshLog', () => {
  it('parses Accepted publickey + Failed password rows including IPv6', () => {
    const input = [
      '2026-05-18T10:00:00+00:00 host sshd[1111]: Accepted publickey for mike from 192.168.1.10 port 51234 ssh2',
      '2026-05-18T10:01:00+00:00 host sshd[1112]: Failed password for invalid user root from 2001:db8::5 port 22 ssh2',
      '2026-05-18T10:02:00+00:00 host sshd[1113]: Failed password for admin from 10.0.0.5 port 51111 ssh2',
      '2026-05-18T10:03:00+00:00 host sshd[1114]: Server listening on 0.0.0.0 port 22.',
    ].join('\n');
    const out = parseSshLog(input);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ status: 'accepted', user: 'mike', ip: '192.168.1.10' });
    expect(out[1]).toMatchObject({ status: 'failed', user: 'root', ip: '2001:db8::5' });
    expect(out[2]).toMatchObject({ status: 'failed', user: 'admin', ip: '10.0.0.5' });
  });

  it('ignores non-sshd journal lines', () => {
    const input =
      '2026-05-18T10:00:00+00:00 host nginx[2222]: 1.2.3.4 GET /foo 200';
    expect(parseSshLog(input)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DB-backed readers — verify ordering + cursor pagination shape
// ---------------------------------------------------------------------------

function makeDbWithRows<T>(rows: T[]) {
  const calls: Array<Record<string, unknown>> = [];
  const limitFn = vi.fn((n: number) => {
    calls.push({ limit: n });
    return Promise.resolve(rows.slice(0, n));
  });
  const orderByFn = vi.fn(() => ({ limit: limitFn }));
  const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
  const fromFn = vi.fn(() => ({ where: whereFn, orderBy: orderByFn }));
  return {
    select: vi.fn(() => ({ from: fromFn })),
    calls,
  };
}

describe('OperationLogReader', () => {
  it('returns nextCursor when more rows exist than limit', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      userId: null,
      method: 'POST',
      path: '/api/x',
      bodySummary: null,
      statusCode: 200,
      durationMs: 5,
      ip: null,
      userAgent: null,
      createdAt: 1_000_000_000 - i,
    }));
    const db = makeDbWithRows(rows);
    const reader = new OperationLogReader(db as never);
    const result = await reader.read({ limit: 10 });
    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBe(String(result.items[9]!.createdAt));
  });

  it('returns null nextCursor when fewer rows than limit', async () => {
    const db = makeDbWithRows([
      {
        id: 1,
        userId: null,
        method: 'GET',
        path: '/x',
        bodySummary: null,
        statusCode: 200,
        durationMs: 1,
        ip: null,
        userAgent: null,
        createdAt: 1,
      },
    ]);
    const reader = new OperationLogReader(db as never);
    const result = await reader.read({ limit: 10 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });
});

describe('LoginLogReader', () => {
  it('paginates with cursor on createdAt', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      username: 'admin',
      result: 'fail' as const,
      reason: 'bad_password',
      ip: null,
      userAgent: null,
      createdAt: 2_000_000_000 - i,
    }));
    const db = makeDbWithRows(rows);
    const reader = new LoginLogReader(db as never);
    const result = await reader.read({ limit: 5 });
    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBe(String(result.items[4]!.createdAt));
  });
});

describe('TaskLogReader', () => {
  it('paginates with cursor on startedAt', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1,
      taskId: 1,
      startedAt: 3_000_000_000 - i,
      finishedAt: null,
      status: 'success' as const,
      exitCode: 0,
      output: null,
    }));
    const db = makeDbWithRows(rows);
    const reader = new TaskLogReader(db as never);
    const result = await reader.read({ limit: 10 });
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });
});
