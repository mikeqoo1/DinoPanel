import { describe, it, expect, vi } from 'vitest';
import { DbBackupTaskRunner } from '../runners/db-backup.runner';

function makeRunner(create: ReturnType<typeof vi.fn>): DbBackupTaskRunner {
  return new DbBackupTaskRunner({ create } as never);
}

const validPayload = { instanceId: 1, retentionGroup: 'nightly', keepLastN: 7 };

describe('DbBackupTaskRunner', () => {
  it('declares the db_backup task type', () => {
    expect(makeRunner(vi.fn()).type).toBe('db_backup');
  });

  it('delegates to BackupsService.create with source "scheduled" and reports the result', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 5,
      instanceId: 1,
      instanceName: 'prod',
      engine: 'postgresql',
      filePath: '/opt/dinopanel/backups/postgresql/prod/123-scheduled.sql.gz',
      byteSize: 1234,
      durationMs: 50,
      source: 'scheduled',
      retentionGroup: 'nightly',
      keepLastN: 7,
      status: 'success',
      error: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const result = await makeRunner(create).run(validPayload);
    expect(result.status).toBe('success');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      instanceId: 1,
      source: 'scheduled',
      retentionGroup: 'nightly',
      keepLastN: 7,
    });
    expect(result.output).toContain('backup #5');
    expect(result.output).toContain('instance=prod');
    expect(result.output).toContain('engine=postgresql');
    expect(result.output).toContain('1234B');
    expect(result.output).toContain('duration=50ms');
    expect(result.output).toMatch(/file=.*\.sql\.gz/);
  });

  it('rejects a payload missing instanceId without calling create', async () => {
    const create = vi.fn();
    const result = await makeRunner(create).run({ retentionGroup: 'nightly', keepLastN: 7 });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('Invalid db_backup payload');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an invalid retentionGroup (uppercase) without calling create', async () => {
    const create = vi.fn();
    const result = await makeRunner(create).run({
      instanceId: 1,
      retentionGroup: 'Nightly',
      keepLastN: 7,
    });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('Invalid db_backup payload');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects keepLastN below 1 without calling create', async () => {
    const create = vi.fn();
    const result = await makeRunner(create).run({
      instanceId: 1,
      retentionGroup: 'nightly',
      keepLastN: 0,
    });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('Invalid db_backup payload');
    expect(create).not.toHaveBeenCalled();
  });

  it('wraps a BackupsService.create failure in a failed result instead of throwing', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db instance 99 not found'));
    const result = await makeRunner(create).run({
      instanceId: 99,
      retentionGroup: 'nightly',
      keepLastN: 7,
    });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('db instance 99 not found');
  });
});
