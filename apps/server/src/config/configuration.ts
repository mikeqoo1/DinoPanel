import { loadEnv, type Env } from './env.schema';

export interface AppConfig {
  env: Env;
  isDev: boolean;
  isProd: boolean;
  corsOrigins: string[];
}

export function loadConfig(): AppConfig {
  const env = loadEnv(process.env);
  return {
    env,
    isDev: env.NODE_ENV === 'development',
    isProd: env.NODE_ENV === 'production',
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
