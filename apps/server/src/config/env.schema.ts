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
  // PHP-FPM upstream — Unix socket path OR `tcp://host:port`.
  // v0.3 expected an operator-provisioned container exposing a Unix
  // socket. v0.4 PhpFpmService auto-provisions a `php:8.3-fpm`
  // container listening on TCP 127.0.0.1:9000 when this env is empty
  // (default behaviour); operators who want manual control still
  // set this to their own socket path or `tcp://host:port`.
  PHP_FPM_SOCKET_PATH: z.string().default(''),

  // v0.4: host nginx conf.d directory that may contain operator-managed
  // (external) conf files. SitesService.reconcile walks this in
  // addition to DinoPanel's own tree; default matches Rocky / Ubuntu
  // nginx packaging.
  HOST_NGINX_CONFD_DIR: z.string().default('/etc/nginx/conf.d'),
  // ACME directory URL. Default = Let's Encrypt staging (so a botched
  // smoke pass doesn't burn the 5/week prod rate limit). Operators flip
  // to LE prod after staging works.
  ACME_DIRECTORY_URL: z
    .string()
    .url()
    .default('https://acme-staging-v02.api.letsencrypt.org/directory'),
  // Account email for ACME registration. Empty by default — issuance
  // throws ACME_EMAIL_NOT_SET if it's missing at first attempt.
  ACME_EMAIL: z.string().default(''),

  // v0.4 databases — root for bind-mount data dirs
  // (`<DATABASES_ROOT>/<engine>/<instance>/`). Defaults under
  // `/opt/dinopanel/databases` per decisions.md Q2.
  DATABASES_ROOT: z.string().default('/opt/dinopanel/databases'),

  // v0.4 PMM PromQL client. URL reuses v0.2.1 setting
  // `monitoring.pmm_url` (settings table, not env). Env override path
  // for the API token + TLS skip lives here.
  MONITORING_PMM_API_TOKEN: z.string().default(''),
  // PMM ships self-signed certs by default; v0.2.1's MonitoringService.probe()
  // hardcodes rejectUnauthorized:false for /v1/readyz. v0.4.4 aligns the
  // PromQL + Inventory clients with that posture by flipping the default
  // here from 'false' (verify) to 'true' (skip). Operators with a properly
  // issued cert can opt back in via env `MONITORING_PMM_TLS_SKIP_VERIFY=false`
  // or setting key `monitoring.pmm_tls_skip_verify=false`.
  MONITORING_PMM_TLS_SKIP_VERIFY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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
