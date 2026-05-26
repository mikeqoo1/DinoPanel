import { describe, it, expect } from 'vitest';
import type Dockerode from 'dockerode';
import {
  bufferingExec,
  streamingDumpExec,
  streamingRestoreExec,
} from '../exec-stream';
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

describe('streamingDumpExec', () => {
  it('demuxes stdout frames and ignores stderr on a clean exit', async () => {
    const fake = makeFakeContainer({
      scripts: [
        {
          output: [
            frame(1, 'hello '),
            frame(2, 'noise on stderr'),
            frame(1, 'world'),
          ],
          exitCode: 0,
        },
      ],
    });
    const stream = await streamingDumpExec({
      container: asContainer(fake),
      cmd: ['mysqldump'],
    });
    const buf = await collect(stream);
    expect(buf.toString('utf8')).toBe('hello world');
    expect(getCall(fake, 0).Cmd).toEqual(['mysqldump']);
  });

  it('passes Env to exec and the stream completes', async () => {
    const fake = makeFakeContainer({
      scripts: [{ output: [frame(1, 'ok')], exitCode: 0 }],
    });
    await collect(
      await streamingDumpExec({
        container: asContainer(fake),
        cmd: ['mysqldump'],
        env: ['MYSQL_PWD=secret'],
      }),
    );
    expect(getCall(fake, 0).Env).toEqual(['MYSQL_PWD=secret']);
  });

  it('propagates non-zero exit as a stream error with stderr captured', async () => {
    const fake = makeFakeContainer({
      scripts: [
        {
          output: [frame(2, 'access denied')],
          exitCode: 1,
        },
      ],
    });
    const stream = await streamingDumpExec({
      container: asContainer(fake),
      cmd: ['mysqldump'],
    });
    await expect(collect(stream)).rejects.toThrow(/access denied|exit=1/);
  });

  it('handles a payload split across multiple chunks', async () => {
    const big = Buffer.from('A'.repeat(5000), 'utf8');
    const framed = frame(1, big);
    // Split into pieces that don't align to the header boundary
    const a = framed.subarray(0, 3);
    const b = framed.subarray(3, 100);
    const c = framed.subarray(100);
    const fake = makeFakeContainer({
      scripts: [{ output: [a, b, c], exitCode: 0 }],
    });
    const buf = await collect(
      await streamingDumpExec({
        container: asContainer(fake),
        cmd: ['mysqldump'],
      }),
    );
    expect(buf.length).toBe(5000);
    expect(buf.toString('utf8')).toBe('A'.repeat(5000));
  });
});

describe('streamingRestoreExec', () => {
  it('pipes the input stream into stdin and resolves on exit 0', async () => {
    const fake = makeFakeContainer({
      scripts: [{ exitCode: 0, captureStdin: true }],
    });
    await streamingRestoreExec({
      container: asContainer(fake),
      cmd: ['mysql'],
      env: ['MYSQL_PWD=secret'],
      input: readableFrom('INSERT INTO t VALUES (1);'),
    });
    const call = getCall(fake, 0);
    expect(call.AttachStdin).toBe(true);
    expect(call.stdin.toString('utf8')).toBe('INSERT INTO t VALUES (1);');
    expect(call.Env).toEqual(['MYSQL_PWD=secret']);
  });

  it('throws ExecError with stderr surface on non-zero exit', async () => {
    const fake = makeFakeContainer({
      scripts: [
        {
          captureStdin: true,
          output: [frame(2, 'syntax error at line 3')],
          exitCode: 2,
        },
      ],
    });
    await expect(
      streamingRestoreExec({
        container: asContainer(fake),
        cmd: ['mysql'],
        input: readableFrom('garbage'),
      }),
    ).rejects.toThrow(/syntax error at line 3|exit=2/);
  });
});

describe('bufferingExec', () => {
  it('returns stdout as a string', async () => {
    const fake = makeFakeContainer({
      scripts: [{ output: [frame(1, '1716302400\n')], exitCode: 0 }],
    });
    const { stdout } = await bufferingExec({
      container: asContainer(fake),
      cmd: ['redis-cli', 'LASTSAVE'],
    });
    expect(stdout.trim()).toBe('1716302400');
  });

  it('throws on non-zero exit', async () => {
    const fake = makeFakeContainer({
      scripts: [{ output: [frame(2, 'WRONGPASS')], exitCode: 1 }],
    });
    await expect(
      bufferingExec({ container: asContainer(fake), cmd: ['redis-cli', 'PING'] }),
    ).rejects.toThrow(/WRONGPASS|exit=1/);
  });
});
