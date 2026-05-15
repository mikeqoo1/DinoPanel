import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

interface DockerodeError {
  statusCode?: number;
  message?: string;
  reason?: string;
}

/**
 * Map a dockerode error to an appropriate NestJS HttpException.
 * Unknown errors are re-thrown as-is so ApiExceptionFilter catches them as 500.
 * Mirrors the pattern of mapFsError in files.service.ts.
 */
export function mapDockerError(err: unknown, op: string): never {
  const e = err as DockerodeError;
  const detail = e?.reason || e?.message || op;

  switch (e?.statusCode) {
    case 400:
      throw new BadRequestException({
        code: 'DOCKER_BAD_REQUEST',
        message: detail,
      });
    case 401:
      throw new UnauthorizedException({
        code: 'DOCKER_UNAUTHORIZED',
        message: detail,
      });
    case 403:
      throw new ForbiddenException({
        code: 'DOCKER_FORBIDDEN',
        message: detail,
      });
    case 404:
      throw new NotFoundException({
        code: 'DOCKER_NOT_FOUND',
        message: `Not found: ${op}`,
      });
    case 409:
      throw new ConflictException({
        code: 'DOCKER_CONFLICT',
        message: detail,
      });
    case 500:
      throw new InternalServerErrorException({
        code: 'DOCKER_INTERNAL_ERROR',
        message: detail,
      });
  }

  // Socket connection refused or other transport-level failure
  // (e.g. ENOENT on /var/run/docker.sock, ECONNREFUSED)
  const nodeErr = err as NodeJS.ErrnoException;
  if (nodeErr?.code === 'ENOENT' || nodeErr?.code === 'ECONNREFUSED' || nodeErr?.code === 'EACCES') {
    throw new ServiceUnavailableException({
      code: 'DOCKER_UNREACHABLE',
      message: 'Docker daemon is not reachable',
    });
  }

  throw err;
}
