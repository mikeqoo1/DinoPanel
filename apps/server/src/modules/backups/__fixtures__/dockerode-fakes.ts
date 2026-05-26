import { Duplex, PassThrough, Readable } from 'node:stream';
import type Dockerode from 'dockerode';
import { vi } from 'vitest';

/**
 * Builds a docker exec multiplex frame:
 *   byte 0   = streamType (1=stdout, 2=stderr)
 *   bytes 1-3 = padding
 *   bytes 4-7 = uint32 BE payload length
 *   bytes 8+  = payload
 *
 * Use to feed FakeContainer.exec().start() with realistic docker-shaped
 * data for the demuxer to chew through.
 */
export function frame(streamType: 1 | 2, payload: Buffer | string): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

export interface ScriptedExec {
  /** Frames emitted on the returned stream before `end`. */
  output?: Buffer[];
  /** Exit code returned by `exec.inspect()`. Defaults to 0. */
  exitCode?: number;
  /**
   * When set, `start()` returns a Duplex that captures everything
   * written to stdin. Use for restore exec assertions.
   */
  captureStdin?: boolean;
}

export interface ExecCall {
  Cmd: string[];
  Env?: string[];
  AttachStdin?: boolean;
  stdin: Buffer;
}

export interface FakeContainer {
  exec: (opts: Dockerode.ExecCreateOptions) => Promise<{
    start: (
      opts: { Detach?: boolean; hijack?: boolean; stdin?: boolean },
    ) => Promise<NodeJS.ReadableStream | NodeJS.ReadWriteStream>;
    inspect: () => Promise<{ ExitCode: number }>;
  }>;
  stop: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  calls: ExecCall[];
}

/**
 * Build a FakeContainer whose `exec()` returns successive scripted
 * responses (FIFO). `dispatch` (optional) lets a test return a
 * different scripted response based on the Cmd passed — handy for the
 * redis driver which issues several distinct redis-cli commands in
 * sequence.
 */
export function makeFakeContainer(args: {
  scripts?: ScriptedExec[];
  dispatch?: (call: { Cmd: string[] }) => ScriptedExec;
}): FakeContainer {
  const scripts = args.scripts ? [...args.scripts] : [];
  const calls: ExecCall[] = [];

  const container: FakeContainer = {
    calls,
    stop: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    exec: async (opts) => {
      const script = args.dispatch
        ? args.dispatch({ Cmd: opts.Cmd as string[] })
        : scripts.shift() ?? { exitCode: 0, output: [] };

      const call: ExecCall = {
        Cmd: opts.Cmd as string[],
        Env: opts.Env as string[] | undefined,
        AttachStdin: opts.AttachStdin,
        stdin: Buffer.alloc(0),
      };
      calls.push(call);

      return {
        start: async (startOpts) => {
          if (startOpts.stdin || script.captureStdin) {
            const duplex = new Duplex({
              read() {
                /* readable side: emit scripted frames then end */
              },
              write(chunk: Buffer, _enc, cb) {
                call.stdin = Buffer.concat([call.stdin, chunk]);
                cb();
              },
            });
            // Push scripted frames + EOF on next tick so writer code
            // can subscribe first.
            setImmediate(() => {
              for (const buf of script.output ?? []) duplex.push(buf);
              duplex.push(null);
            });
            duplex.on('finish', () => {
              // mimic docker behaviour — once stdin ends, the readable
              // side has already pushed its frames + null.
            });
            return duplex;
          }

          const readable = new PassThrough();
          setImmediate(() => {
            for (const buf of script.output ?? []) readable.write(buf);
            readable.end();
          });
          return readable;
        },
        inspect: async () => ({ ExitCode: script.exitCode ?? 0 }),
      };
    },
  };
  return container;
}

/** Read an exec call by index, throwing if it isn't there. */
export function getCall(fake: FakeContainer, i: number): ExecCall {
  const c = fake.calls[i];
  if (!c) throw new Error(`expected exec call #${i} (have ${fake.calls.length})`);
  return c;
}

/** Collect a Readable into a single Buffer (test helper). */
export function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Build a Readable from a string for restore-stream test inputs. */
export function readableFrom(text: string): Readable {
  return Readable.from([Buffer.from(text, 'utf8')]);
}
