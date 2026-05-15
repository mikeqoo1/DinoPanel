import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketServer as Wss } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { Logger } from 'nestjs-pino';
import { AuthService } from '../auth/auth.service';
import { authenticateWs } from '../../common/guards/ws-jwt.guard';
import { ImagesService } from './images.service';

// Match URL: /ws/images/pull
const PATH_RE = /^\/ws\/images\/pull$/;

@Injectable()
export class PullGateway implements OnModuleDestroy {
  private wss: Wss | null = null;
  private activeSockets = new Set<WebSocket>();

  constructor(
    private readonly images: ImagesService,
    private readonly auth: AuthService,
    private readonly logger: Logger,
  ) {}

  attachTo(server: HttpServer) {
    this.wss = new Wss({ noServer: true });

    server.on('upgrade', async (req, socket, head) => {
      if (!req.url) return;
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url, `http://${host}`);
      if (!PATH_RE.test(url.pathname)) return;

      const authCtx = await authenticateWs(this.auth, req as IncomingMessage);
      if (!authCtx) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const ref = url.searchParams.get('ref') ?? '';
      if (!ref) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(req as IncomingMessage, socket, head, (ws) => {
        this.onConnection(ws, authCtx.username, ref);
      });
    });

    this.logger.log('Pull gateway attached to /ws/images/pull');
  }

  onModuleDestroy() {
    for (const ws of this.activeSockets) {
      try {
        ws.close(1001, 'server shutdown');
      } catch {
        // ignore
      }
    }
    this.activeSockets.clear();
    this.wss?.close();
  }

  private onConnection(ws: WebSocket, username: string, ref: string) {
    this.activeSockets.add(ws);
    this.logger.log({ username, ref }, 'pull client connected');

    const cleanup = () => {
      this.activeSockets.delete(ws);
      this.logger.log({ username, ref }, 'pull client disconnected');
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);

    this.images
      .pull(ref, {
        onProgress: (event) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(event));
          }
        },
      })
      .then(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'end' }));
          ws.close(1000, 'pull complete');
        }
      })
      .catch((err: { response?: { code?: string }; statusCode?: number; code?: string }) => {
        const code =
          err?.response?.code ??
          (err?.statusCode === 404
            ? 'DOCKER_NOT_FOUND'
            : err?.code === 'ENOENT' || err?.code === 'ECONNREFUSED'
              ? 'DOCKER_UNREACHABLE'
              : 'DOCKER_UNREACHABLE');
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', code }));
          ws.close(1011, 'pull error');
        }
      });
  }
}
