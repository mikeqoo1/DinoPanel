import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { shellPayloadSchema, type ScheduledTaskType } from '@dinopanel/shared';
import {
  capOutput,
  failedResult,
  successResult,
  type RunResult,
  type TaskRunner,
} from '../task-runner';

const SHELL_TIMEOUT_MS = 5 * 60_000;

@Injectable()
export class ShellTaskRunner implements TaskRunner {
  readonly type: ScheduledTaskType = 'shell';

  run(payload: unknown): Promise<RunResult> {
    const parsed = shellPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return Promise.resolve(failedResult(`Invalid shell payload: ${parsed.error.message}`));
    }
    return new Promise<RunResult>((resolve) => {
      const child = spawn('/bin/sh', ['-c', parsed.data.command], {
        timeout: SHELL_TIMEOUT_MS,
      });
      let out = '';
      let timedOut = false;

      const onChunk = (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (out.length > 80 * 1024) out = out.slice(out.length - 80 * 1024);
      };
      child.stdout.on('data', onChunk);
      child.stderr.on('data', onChunk);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, SHELL_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(failedResult(`spawn error: ${err.message}\n${out}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve(failedResult(`Timed out after ${SHELL_TIMEOUT_MS}ms\n${out}`, code));
          return;
        }
        const result: RunResult =
          code === 0 ? successResult(out, 0) : failedResult(capOutput(out), code);
        resolve(result);
      });
    });
  }
}
