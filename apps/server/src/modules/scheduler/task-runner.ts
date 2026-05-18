import type { ScheduledTaskType } from '@dinopanel/shared';

export interface RunResult {
  exitCode: number | null;
  output: string;
  status: 'success' | 'failed';
}

export interface TaskRunner {
  readonly type: ScheduledTaskType;
  run(payload: unknown): Promise<RunResult>;
}

export const OUTPUT_CAP_BYTES = 64 * 1024;
const TRUNCATION_MARKER = '\n[truncated]';

export function capOutput(s: string): string {
  if (s.length <= OUTPUT_CAP_BYTES) return s;
  return s.slice(0, OUTPUT_CAP_BYTES - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

export function failedResult(message: string, exitCode: number | null = null): RunResult {
  return { exitCode, output: capOutput(message), status: 'failed' };
}

export function successResult(output: string, exitCode: number | null = 0): RunResult {
  return { exitCode, output: capOutput(output), status: 'success' };
}
