import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Logger as PinoLogger } from 'nestjs-pino';
import type { ApiErrorResponse } from '@dinopanel/shared';

const HTTP_STATUS_CODE_MAP: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
};

function statusToCode(status: number): string {
  return HTTP_STATUS_CODE_MAP[status] ?? 'INTERNAL_ERROR';
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Pick<PinoLogger, 'error'>) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const nestResponse = exception.getResponse();

      let body: ApiErrorResponse;

      if (typeof nestResponse === 'object' && nestResponse !== null) {
        const res = nestResponse as Record<string, unknown>;

        // Respect controller-supplied code (e.g. from ZodValidationPipe or services)
        if (typeof res['code'] === 'string') {
          body = {
            code: res['code'],
            message: typeof res['message'] === 'string' ? res['message'] : exception.message,
            details: res['details'],
          };
        } else {
          // Standard NestJS shape: { statusCode, message, error }
          const rawMessage = res['message'];
          let message: string;
          let details: unknown;

          if (Array.isArray(rawMessage)) {
            // class-validator produces message arrays
            message = rawMessage.join('; ');
            details = { errors: rawMessage };
          } else {
            message = typeof rawMessage === 'string' ? rawMessage : exception.message;
          }

          body = {
            code: statusToCode(status),
            message,
            ...(details !== undefined ? { details } : {}),
          };
        }
      } else {
        // String response
        body = {
          code: statusToCode(status),
          message: typeof nestResponse === 'string' ? nestResponse : exception.message,
        };
      }

      reply.status(status).send(body);
      return;
    }

    // Unknown / unhandled Error — log full stack, send generic 500 to client
    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error({ err, stack: err.stack }, 'Unhandled exception');

    const body: ApiErrorResponse = {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send(body);
  }
}
