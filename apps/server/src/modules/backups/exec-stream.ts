import { PassThrough } from 'node:stream';
import type { Writable } from 'node:stream';
import type Dockerode from 'dockerode';

/**
 * docker exec multiplex frame:
 *   byte 0   = stream type (1=stdout, 2=stderr)
 *   bytes 1-3 = padding
 *   bytes 4-7 = uint32 BE payload length
 *   bytes 8+  = payload
 *
 * Used by all helpers below to split stdout from stderr when the exec
 * was started without `Tty: true`.
 */
const FRAME_HEADER_BYTES = 8;
const STDERR_STREAM_TYPE = 2;

export interface ExecError extends Error {
  exitCode: number | null;
  stderr: string;
}

/**
 * Parse as many complete docker multiplex frames as `buffer` contains
 * and dispatch their payloads. Returns the unconsumed tail (bytes of
 * a partially-arrived next frame). Used by all three exec helpers so
 * the demux logic only lives in one place.
 */
function consumeFrames(
  buffer: Buffer,
  onStdout: (payload: Buffer) => void,
  onStderr: (text: string) => void,
): Buffer {
  let rest = buffer;
  while (rest.length >= FRAME_HEADER_BYTES) {
    const streamType = rest[0];
    const length = rest.readUInt32BE(4);
    if (rest.length < FRAME_HEADER_BYTES + length) break;
    const payload = rest.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length);
    if (streamType === STDERR_STREAM_TYPE) {
      onStderr(payload.toString('utf8'));
    } else {
      onStdout(payload);
    }
    rest = rest.subarray(FRAME_HEADER_BYTES + length);
  }
  return rest;
}

function makeExecError(exitCode: number | null, stderr: string): ExecError {
  return Object.assign(
    new Error(
      `exec failed: exit=${exitCode}${stderr ? ` stderr=${stderr.trim()}` : ''}`,
    ),
    { exitCode, stderr },
  );
}

/**
 * Run a command inside the container and return a Readable that
 * yields the demuxed stdout bytes. The returned Readable emits
 * `'error'` (an `ExecError`) instead of `'end'` when the exec exits
 * with a non-zero status — stderr (if any) is attached to the error
 * for log surfacing. A zero exit always resolves with `'end'` even if
 * the command wrote informational output to stderr (mysqldump,
 * mongodump and friends routinely log progress notes there).
 *
 * The function awaits the `exec.start()` handshake before resolving so
 * the caller can attach `.pipe()` synchronously after `await`. The
 * actual data flow is fully streamed — no buffering of stdout.
 */
export async function streamingDumpExec(args: {
  container: Dockerode.Container;
  cmd: string[];
  env?: string[];
}): Promise<NodeJS.ReadableStream> {
  const exec = await args.container.exec({
    Cmd: args.cmd,
    AttachStdout: true,
    AttachStderr: true,
    ...(args.env ? { Env: args.env } : {}),
  });
  const stream = (await exec.start({
    Detach: false,
    hijack: true,
  })) as NodeJS.ReadableStream;

  const stdout = new PassThrough();
  let stderr = '';
  let buffer: Buffer = Buffer.alloc(0);

  stream.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    buffer = consumeFrames(
      buffer,
      (payload) => stdout.write(payload),
      (text) => {
        stderr += text;
      },
    );
  });

  stream.on('error', (err: Error) => stdout.destroy(err));

  stream.on('end', async () => {
    try {
      const info = await exec.inspect();
      const exitCode = info.ExitCode ?? null;
      if (exitCode !== 0) {
        stdout.destroy(makeExecError(exitCode, stderr));
        return;
      }
      stdout.end();
    } catch (err) {
      stdout.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return stdout;
}

/**
 * Run a command inside the container and pipe `input` into its stdin.
 * Resolves after the exec ends with exit code 0. Throws `ExecError`
 * with stderr surface otherwise.
 *
 * Used for restore: dump file → gunzip → here.
 */
export async function streamingRestoreExec(args: {
  container: Dockerode.Container;
  cmd: string[];
  env?: string[];
  input: NodeJS.ReadableStream;
}): Promise<void> {
  const exec = await args.container.exec({
    Cmd: args.cmd,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    ...(args.env ? { Env: args.env } : {}),
  });
  const duplex = (await exec.start({
    Detach: false,
    hijack: true,
    stdin: true,
  })) as NodeJS.ReadWriteStream;

  let stderr = '';
  let buffer: Buffer = Buffer.alloc(0);

  const drained = new Promise<void>((resolve, reject) => {
    duplex.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      buffer = consumeFrames(
        buffer,
        () => undefined,
        (text) => {
          stderr += text;
        },
      );
    });
    duplex.on('end', resolve);
    duplex.on('error', reject);
  });

  // Pipe input → duplex stdin. End the duplex when input ends so the
  // remote process sees EOF on stdin (otherwise mysql / psql / etc.
  // wait forever).
  args.input.pipe(duplex as unknown as Writable, { end: true });

  await drained;

  const info = await exec.inspect();
  const exitCode = info.ExitCode ?? null;
  if (exitCode !== 0) throw makeExecError(exitCode, stderr);
}

/**
 * Run a command and buffer its stdout (small responses only — e.g.
 * `redis-cli LASTSAVE`). Throws `ExecError` on non-zero exit.
 */
export async function bufferingExec(args: {
  container: Dockerode.Container;
  cmd: string[];
  env?: string[];
}): Promise<{ stdout: string; stderr: string }> {
  const exec = await args.container.exec({
    Cmd: args.cmd,
    AttachStdout: true,
    AttachStderr: true,
    ...(args.env ? { Env: args.env } : {}),
  });
  const stream = (await exec.start({
    Detach: false,
    hijack: true,
  })) as NodeJS.ReadableStream;

  let stdout = '';
  let stderr = '';
  let buffer: Buffer = Buffer.alloc(0);

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      buffer = consumeFrames(
        buffer,
        (payload) => {
          stdout += payload.toString('utf8');
        },
        (text) => {
          stderr += text;
        },
      );
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const info = await exec.inspect();
  const exitCode = info.ExitCode ?? null;
  if (exitCode !== 0) throw makeExecError(exitCode, stderr);
  return { stdout, stderr };
}
