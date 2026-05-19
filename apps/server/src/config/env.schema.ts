import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(9999),
  HOST: z.string().default('127.0.0.1'),
  SSH_PORT: z.coerce.number().int().min(1).max(65535).default(22),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  DATA_DIR: z.string().default('./data'),

  CORS_ORIGINS: z.string().default(''),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  WEB_DIST: z.string().default(''),

  // v0.3 websites — root tree on disk. /opt/dinopanel matches Q4 decision;
  // overridable for dev/test so the suite can use a tmp dir.
  WEBSITES_ROOT: z.string().default('/opt/dinopanel'),
  // Path to the file written into the host nginx tree. `00-` prefix wins
  // alphabetical ordering inside conf.d. Override only if a packaged file
  // already owns the path.
  WEBSITES_NGINX_INCLUDE_PATH: z
    .string()
    .default('/etc/nginx/conf.d/00-dinopanel.conf'),
  // Hard requirement in prod; flip to 'false' for dev where sudo isn't
  // configured and the bootstrap probe would otherwise log a noisy warning.
  WEBSITES_REQUIRE_SUDO: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // PHP-FPM Unix socket path. v0.3 expects an operator-provisioned
  // container exposing this socket via a shared volume mount; see
  // docs/websites.md. Override if the operator chose a different path.
  PHP_FPM_SOCKET_PATH: z
    .string()
    .default('/run/php-fpm/dinopanel-php-8.3.sock'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
