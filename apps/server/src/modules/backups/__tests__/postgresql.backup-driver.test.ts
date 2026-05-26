import { describe, it, expect } from 'vitest';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import { PostgresqlBackupDriver } from '../drivers/postgresql.backup-driver';
import {
  collect,
  frame,
  getCall,
  makeFakeContainer,
  readableFrom,
} from '../__fixtures__/dockerode-fakes';

function asContainer(c: ReturnType<typeof makeFakeContainer>): Dockerode.Container {
  return c as unknown as Dockerode.Container;
}

function makeInstance(): DbInstance {
  return {
    id: 2,
    name: 'orders',
    engine: 'postgresql',
    imageTag: 'postgres:18',
    port: 49_010,
    username: 'postgres',
    password: 'pgpw',
    dataDir: '/opt/dinopanel/databases/postgresql/orders',
    containerName: 'dinopanel-postgresql-orders',
    status: 'running',
    lastError: null,
    pmmRegistered: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('PostgresqlBackupDriver', () => {
  it('issues pg_dumpall --clean --if-exists with PGPASSWORD env', async () => {
    const fake = makeFakeContainer({
      scripts: [
        { output: [frame(1, '-- PostgreSQL database cluster dump\n')], exitCode: 0 },
      ],
    });
    const driver = new PostgresqlBackupDriver();
    const stream = await driver.dump({
      container: asContainer(fake),
      instance: makeInstance(),
    });
    await collect(stream);
    const call = getCall(fake, 0);
    expect(call.Cmd).toEqual([
      'pg_dumpall',
      '-U',
      'postgres',
      '--clean',
      '--if-exists',
    ]);
    expect(call.Env).toEqual(['PGPASSWORD=pgpw']);
    expect(call.Cmd.join(' ')).not.toContain('pgpw');
  });

  it('propagates non-zero pg_dumpall exit as a stream error', async () => {
    const fake = makeFakeContainer({
      scripts: [
        { output: [frame(2, 'could not connect to server')], exitCode: 1 },
      ],
    });
    const driver = new PostgresqlBackupDriver();
    const stream = await driver.dump({
      container: asContainer(fake),
      instance: makeInstance(),
    });
    await expect(collect(stream)).rejects.toThrow(/could not connect|exit=1/);
  });

  it('restore pipes SQL into psql -d postgres with PGPASSWORD env', async () => {
    const fake = makeFakeContainer({
      scripts: [{ exitCode: 0, captureStdin: true }],
    });
    const driver = new PostgresqlBackupDriver();
    await driver.restore({
      container: asContainer(fake),
      instance: makeInstance(),
      stream: readableFrom('SELECT 1;'),
    });
    const call = getCall(fake, 0);
    expect(call.Cmd).toEqual([
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ]);
    expect(call.Env).toEqual(['PGPASSWORD=pgpw']);
    expect(call.stdin.toString('utf8')).toBe('SELECT 1;');
  });
});
