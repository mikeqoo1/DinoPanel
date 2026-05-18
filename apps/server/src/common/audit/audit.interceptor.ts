import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Observable, tap } from 'rxjs';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { operationLog } from '../../database/schema';
import { SENSITIVE_BODY_FIELDS, REDACTION_PLACEHOLDER } from './sensitive-fields';

const BODY_SUMMARY_CAP_BYTES = 1024;
const TRUNCATION_MARKER = '[truncated]';

interface AuthedRequest extends FastifyRequest {
  user?: { id: number; username: string };
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    if (!shouldAudit(req)) return next.handle();

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.write(req, reply, startedAt, reply.statusCode),
        error: (err: unknown) => this.write(req, reply, startedAt, statusFromError(err)),
      }),
    );
  }

  private write(
    req: AuthedRequest,
    reply: FastifyReply,
    startedAt: number,
    statusCode: number,
  ): void {
    try {
      void this.db
        .insert(operationLog)
        .values({
          userId: req.user?.id ?? null,
          method: req.method,
          path: routeTemplate(req),
          bodySummary: summarizeBody(req.body),
          statusCode,
          durationMs: Date.now() - startedAt,
          ip: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
        })
        .catch?.((err: unknown) => {
          this.logger.warn({ err, path: req.url }, 'audit.write_failed');
        });
    } catch (err) {
      this.logger.warn({ err, path: req.url }, 'audit.write_failed');
    }
  }
}

function shouldAudit(req: AuthedRequest): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return false;
  const url = req.url ?? '';
  if (!url.startsWith('/api/')) return false;
  if (url.startsWith('/api/auth/')) return false;
  return true;
}

function routeTemplate(req: AuthedRequest): string {
  // Fastify v5: route template lives on routeOptions.url; routerPath was removed.
  const template = req.routeOptions?.url;
  return template ?? req.url ?? '';
}

function statusFromError(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const status = (err as { status?: unknown; statusCode?: unknown }).status
      ?? (err as { status?: unknown; statusCode?: unknown }).statusCode;
    if (typeof status === 'number') return status;
  }
  return 500;
}

export function summarizeBody(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body !== 'object') {
    return cap(typeof body === 'string' ? body : String(body));
  }
  const redacted = redactSensitiveFields(body as Record<string, unknown>);
  try {
    return cap(JSON.stringify(redacted));
  } catch {
    return cap('[unserializable]');
  }
}

function redactSensitiveFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  for (const field of SENSITIVE_BODY_FIELDS) {
    if (field in out) out[field] = REDACTION_PLACEHOLDER;
  }
  return out;
}

function cap(s: string): string {
  if (s.length <= BODY_SUMMARY_CAP_BYTES) return s;
  return s.slice(0, BODY_SUMMARY_CAP_BYTES - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}
