import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loadConfig } from './config/configuration';
import { DatabaseModule } from './database/db.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SystemModule } from './modules/system/system.module';
import { TerminalModule } from './modules/terminal/terminal.module';
import { FilesModule } from './modules/files/files.module';
import { ContainersModule } from './modules/containers/containers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [() => ({ app: loadConfig() })],
    }),
    LoggerModule.forRootAsync({
      useFactory: () => {
        const isDev = process.env.NODE_ENV !== 'production';
        return {
          pinoHttp: {
            level: process.env.LOG_LEVEL ?? 'info',
            transport: isDev
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true, translateTime: 'SYS:HH:MM:ss' },
                }
              : undefined,
            customProps: () => ({ service: 'dinopanel-server' }),
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                'req.body.password',
                'req.body.oldPassword',
                'req.body.newPassword',
                'req.body.refreshToken',
              ],
              censor: '[redacted]',
            },
            autoLogging: { ignore: (req) => req.url === '/api/health' },
          },
        };
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    SystemModule,
    TerminalModule,
    FilesModule,
    ContainersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
