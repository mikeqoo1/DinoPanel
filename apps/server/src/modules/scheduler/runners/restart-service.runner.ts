import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { restartServicePayloadSchema, type ScheduledTaskType } from '@dinopanel/shared';
import { failedResult, successResult, type RunResult, type TaskRunner } from '../task-runner';

const RESTART_TIMEOUT_MS = 60_000;

@Injectable()
export class RestartServiceTaskRunner implements TaskRunner {
  readonly type: ScheduledTaskType = 'restart_service';

  run(payload: unknown): Promise<RunResult> {
    const parsed = restartServicePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return Promise.resolve(
        failedResult(`Invalid restart_service payload: ${parsed.error.message}`),
      );
    }
    const unit = parsed.data.unit;
    return new Promise<RunResult>((resolve) => {
      const child = spawn('systemctl', ['restart', unit], { timeout: RESTART_TIMEOUT_MS });
      let out = '';
      child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')));
      child.stderr.on('data', (b: Buffer) => (out += b.toString('utf8')));
      child.on('error', (err) => {
        resolve(failedResult(`systemctl spawn error: ${err.message}\n${out}`));
      });
      child.on('close', (code) => {
        const tail = out || `systemctl restart ${unit}`;
        if (code === 0) {
          resolve(successResult(tail, 0));
        } else {
          resolve(failedResult(tail, code));
        }
      });
    });
  }
}
