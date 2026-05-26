import { describe, it, expect } from 'vitest';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import { MongodbBackupDriver } from '../drivers/mongodb.backup-driver';
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
    id: 3,
    name: 'analytics',
    engine: 'mongodb',
    imageTag: 'mongo:7.0',
    port: 49_020,
    username: 'root',
    password: 'mongopw',
    dataDir: '/opt/dinopanel/databases/mongodb/analytics',
    containerName: 'dinopanel-mongodb-analytics',
    status: 'running',
    lastError: null,
    pmmRegistered: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('MongodbBackupDriver', () => {
  it('declares alreadyGzipped=true and extension=archive (mongodump --gzip output)', () => {
    const driver = new MongodbBackupDriver();
    expect(driver.alreadyGzipped).toBe(true);
    expect(driver.extension).toBe('archive');
  });

  it('issues mongodump --archive --gzip with auth args', async () => {
    const fake = makeFakeContainer({
      scripts: [{ output: [frame(1, Buffer.from([0x1f, 0x8b, 0x08]))], exitCode: 0 }],
    });
    const driver = new MongodbBackupDriver();
    const stream = await driver.dump({
      container: asContainer(fake),
      instance: makeInstance(),
    });
    const buf = await collect(stream);
    expect(buf.slice(0, 2)).toEqual(Buffer.from([0x1f, 0x8b])); // gzip magic
    expect(getCall(fake, 0).Cmd).toEqual([
      'mongodump',
      '--archive',
      '--gzip',
      '--username',
      'root',
      '--password',
      'mongopw',
      '--authenticationDatabase',
      'admin',
    ]);
  });

  it('propagates mongodump failure as stream error', async () => {
    const fake = makeFakeContainer({
      scripts: [{ output: [frame(2, 'auth failed')], exitCode: 1 }],
    });
    const driver = new MongodbBackupDriver();
    const stream = await driver.dump({
      container: asContainer(fake),
      instance: makeInstance(),
    });
    await expect(collect(stream)).rejects.toThrow(/auth failed|exit=1/);
  });

  it('restore pipes archive into mongorestore --archive --gzip --drop', async () => {
    const fake = makeFakeContainer({
      scripts: [{ exitCode: 0, captureStdin: true }],
    });
    const driver = new MongodbBackupDriver();
    await driver.restore({
      container: asContainer(fake),
      instance: makeInstance(),
      stream: readableFrom('binary-archive-bytes'),
    });
    const call = getCall(fake, 0);
    expect(call.Cmd).toEqual([
      'mongorestore',
      '--archive',
      '--gzip',
      '--drop',
      '--username',
      'root',
      '--password',
      'mongopw',
      '--authenticationDatabase',
      'admin',
    ]);
    expect(call.stdin.toString('utf8')).toBe('binary-archive-bytes');
  });
});
