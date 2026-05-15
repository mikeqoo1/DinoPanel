import 'reflect-metadata';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import fastifyStatic from '@fastify/static';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';
import { MetricsGateway } from './modules/system/metrics.gateway';
import { TerminalGateway } from './modules/terminal/terminal.gateway';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    trustProxy: false,
    bodyLimit: 100 * 1024 * 1024, // 100 MB for file uploads
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));

  const pinoLogger = app.get(PinoLogger);
  app.useGlobalFilters(new ApiExceptionFilter(pinoLogger));

  const config = app.get(ConfigService).get<AppConfig>('app', { infer: true });
  if (!config) throw new Error('App config missing');

  app.setGlobalPrefix('api', { exclude: [] });

  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });

  app.enableShutdownHooks();

  // Serve the web SPA static files when WEB_DIST is configured.
  const webDist = config.env.WEB_DIST
    ? resolve(config.env.WEB_DIST)
    : resolve(__dirname, '../../web');
  const hasWeb = existsSync(webDist) && statSync(webDist).isDirectory();
  if (hasWeb) {
    const fastify = app.getHttpAdapter().getInstance();
    await fastify.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
      decorateReply: true,
    });
    // SPA fallback: rewrite 404 GETs (outside /api, /ws) to index.html.
    const indexHtml = readFileSync(join(webDist, 'index.html'));
    fastify.addHook('onSend', (req, reply, payload, done) => {
      if (
        reply.statusCode === 404 &&
        req.method === 'GET' &&
        !req.url.startsWith('/api') &&
        !req.url.startsWith('/ws')
      ) {
        reply.code(200).type('text/html; charset=utf-8');
        done(null, indexHtml);
        return;
      }
      done(null, payload);
    });
  }

  // Attach raw WebSocket gateways after Nest is initialized.
  await app.init();
  const httpServer = app.getHttpServer();
  app.get(MetricsGateway).attachTo(httpServer);
  app.get(TerminalGateway).attachTo(httpServer);

  await app.listen(config.env.PORT, config.env.HOST);

  const logger = app.get(PinoLogger);
  logger.log(`DinoPanel server listening on http://${config.env.HOST}:${config.env.PORT}`);

  const uid = process.getuid?.() ?? -1;
  if (uid !== 0) {
    logger.warn(
      `DinoPanel is running as non-root (uid=${uid}). File management, service control, firewall, and container features will be limited or unavailable. For production, run as root via systemd.`,
    );
  }
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
