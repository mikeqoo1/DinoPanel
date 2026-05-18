import { Injectable } from '@nestjs/common';
import { httpRequestPayloadSchema, type ScheduledTaskType } from '@dinopanel/shared';
import { failedResult, successResult, type RunResult, type TaskRunner } from '../task-runner';

const HTTP_TIMEOUT_MS = 30_000;

@Injectable()
export class HttpRequestTaskRunner implements TaskRunner {
  readonly type: ScheduledTaskType = 'http_request';

  async run(payload: unknown): Promise<RunResult> {
    const parsed = httpRequestPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return failedResult(`Invalid http_request payload: ${parsed.error.message}`);
    }
    const { url, method, headers, body } = parsed.data;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const init: RequestInit = {
        method,
        headers: headers ?? undefined,
        signal: controller.signal,
      };
      if (body !== undefined && method !== 'GET') {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!headers?.['content-type'] && !headers?.['Content-Type']) {
          init.headers = { ...(headers ?? {}), 'content-type': 'application/json' };
        }
      }
      const res = await fetch(url, init);
      const text = await res.text();
      const summary = `${res.status} ${res.statusText}\n${text}`;
      if (res.ok) return successResult(summary, res.status);
      return failedResult(summary, res.status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return failedResult(`http_request failed: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
