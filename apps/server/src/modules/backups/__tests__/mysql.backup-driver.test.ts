import { describe, it, expect } from 'vitest';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import { MariadbBackupDriver } from '../drivers/mariadb.backup-driver';
import { MysqlBackupDriver } from '../drivers/mysql.backup-driver';
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

function makeInstance(engine: 'mysql' | 'mariadb' = 'mysql'): DbInstance {
  return {
    id: 1,
    name: 'shop',
    engine,
    imageTag: 'mysql:8.4',
    port: 49_001,
    username: 'root',
    password: 's3cret',
    dataDir: '/opt/dinopanel/databases/mysql/shop',
    containerName: 'dinopanel-mysql-shop',
    status: 'running',
    lastError: null,
    pmmRegistered: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('MysqlBackupDriver', () => {
  it('emits mysqldump cmd with MYSQL_PWD env (no password on cmdline) and streams SQL out', async () => {
    const fake = makeFakeContainer({
      scripts: [
        {
          output: [
            frame(1, '-- MySQL dump\n'),
            frame(1, 'INSERT INTO t VALUES (1);\n'),
          ],
          exitCode: 0,
        },
      ],
    });
    const driver = new MysqlBackupDriver();
    const stream = await driver.dump({
      container: asContainer(fake),
      instance: makeInstance(),
    });
    const buf = await collect(stream);
    expect(buf.toString('utf8')).toBe(
      '-- MySQL dump\nINSERT INTO t VALUES (1);\n',
    );
    const cmd = getCall(fake, 0).Cmd;
    expect(cmd[0]).toBe('mysqldump');
    expect(cmd).toContain('--single-transaction');
    expect(cmd).toContain('--quick');
    expect(cmd).toContain('--all-databases');
    expect(cmd).toContain('--routines');
    expect(cmd).toContain('--events');
    expect(cmd).toContain('-uroot');
    // WARN-1: password never on cmdline
    expect(cmd.join(' ')).not.toContain('s3cret');
    expect(getCall(fake, 0).Env).toEqual(['MYSQL_PWD=s3cret']);
  });

  it('propagates mysqldump failure as stream error', async () => {
    const fake = makeFakeContainer({
      scripts: [
        {
          output: [frame(2, 'mysqldump: Got error: 1045 access denied')],
          exitCode: 2,
        },
      ],
    });
    const driver = new MysqlBackupDriver();
    const stream = await driver.dump({
      container: asContainer(fake),
      instance: makeInstance(),
    });
    await expect(collect(stream)).rejects.toThrow(/access denied|exit=2/);
  });

  it('restore pipes SQL into mysql stdin with MYSQL_PWD env', async () => {
    const fake = makeFakeContainer({
      scripts: [{ exitCode: 0, captureStdin: true }],
    });
    const driver = new MysqlBackupDriver();
    await driver.restore({
      container: asContainer(fake),
      instance: makeInstance(),
      stream: readableFrom('INSERT INTO t VALUES (42);'),
    });
    const call = getCall(fake, 0);
    expect(call.Cmd[0]).toBe('mysql');
    expect(call.Cmd).toContain('-uroot');
    expect(call.AttachStdin).toBe(true);
    expect(call.stdin.toString('utf8')).toBe(
      'INSERT INTO t VALUES (42);',
    );
    expect(call.Env).toEqual(['MYSQL_PWD=s3cret']);
  });
});

describe('MariadbBackupDriver', () => {
  it('reuses mysqldump command (shim over mysql family)', async () => {
    const fake = makeFakeContainer({
      scripts: [{ output: [frame(1, '-- MariaDB dump\n')], exitCode: 0 }],
    });
    const driver = new MariadbBackupDriver();
    const stream = await driver.dump({
      container: asContainer(fake),
      instance: makeInstance('mariadb'),
    });
    await collect(stream);
    expect(getCall(fake, 0).Cmd[0]).toBe('mysqldump');
    expect(driver.engine).toBe('mariadb');
    expect(driver.alreadyGzipped).toBe(false);
    expect(driver.extension).toBe('sql');
  });
});
