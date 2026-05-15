import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketServer as Wss } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { Inject } from '@nestjs/common';
import Dockerode from 'dockerode';
import { Logger } from 'nestjs-pino';
import { AuthService } from '../auth/auth.service';
import { authenticateWs } from '../../common/guards/ws-jwt.guard';
import { DOCKER } from './docker.token';

// Match URL: /ws/containers/<id>/logs
const PATH_RE = /^\/ws\/containers\/([^/]+)\/logs$/;

interface Session {
  username: string;
  stream: NodeJS.ReadableStream | null;
}

@Injectable()
export class LogsGateway implements OnModuleDestroy {
  private wss: Wss | null = null;
  private sessions = new Map<WebSocket, Session>();

  constructor(
    @Inject(DOCKER) private readonly docker: Dockerode,
    private readonly auth: AuthService,
    private readonly logger: Logger,
  ) {}

  attachTo(server: HttpServer) {
    this.wss = new Wss({ noServer: true });

    server.on('upgrade', async (req, socket, head) => {
      if (!req.url) return;
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url, `http://${host}`);
      const match = PATH_RE.exec(url.pathname);
      if (!match) return;

      const authCtx = await authenticateWs(this.auth, req as IncomingMessage);
      if (!authCtx) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const containerId = match[1]!;
      const tail = Math.max(1, Math.min(10_000, Number(url.searchParams.get('tail')) || 200));

      this.wss!.handleUpgrade(req as IncomingMessage, socket, head, (ws) => {
        this.onConnection(ws, authCtx.username, containerId, { tail });
      });
    });

    this.logger.log('Logs gateway attached to /ws/containers/:id/logs');
  }

  onModuleDestroy() {
    for (const [ws, session] of this.sessions) {
      (session.stream as NodeJS.ReadableStream & { destroy?: () => void })?.destroy?.();
      try {
        ws.close(1001, 'server shutdown');
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
    this.wss?.close();
  }

  private onConnection(
    ws: WebSocket,
    username: string,
    containerId: string,
    opts: { tail: number },
  ) {
    const session: Session = { username, stream: null };
    this.sessions.set(ws, session);
    this.logger.log({ username, containerId }, 'logs client connected');

    const container = this.docker.getContainer(containerId);

    // Use { follow: true } literal to select the ReadableStream overload
    container
      .logs({ stdout: true, stderr: true, follow: true, tail: opts.tail })
      .then((stream: NodeJS.ReadableStream) => {
        if (ws.readyState !== ws.OPEN) {
          (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
          return;
        }

        session.stream = stream;

        stream.on('data', (chunk: Buffer) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(chunk);
          }
        });

        stream.on('end', () => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'end' }));
            ws.close(1000, 'stream ended');
          }
        });

        stream.on('error', (err: Error) => {
          this.logger.error({ err, containerId }, 'logs stream error');
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'error', code: 'DOCKER_UNREACHABLE' }));
            ws.close(1011, 'stream error');
          }
        });
      })
      .catch((err: { statusCode?: number }) => {
        const code = err?.statusCode === 404 ? 'DOCKER_NOT_FOUND' : 'DOCKER_UNREACHABLE';
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', code }));
          ws.close(1011, 'docker error');
        }
      });

    const cleanup = () => {
      (session.stream as NodeJS.ReadableStream & { destroy?: () => void })?.destroy?.();
      this.sessions.delete(ws);
      this.logger.log({ username, containerId }, 'logs client disconnected');
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  }
}
