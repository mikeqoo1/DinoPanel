import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketServer as Wss } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { Subscription } from 'rxjs';
import { Logger } from 'nestjs-pino';
import { AuthService } from '../auth/auth.service';
import { authenticateWs } from '../../common/guards/ws-jwt.guard';
import { SystemService } from './system.service';

const HEARTBEAT_TIMEOUT_MS = 60_000;

interface ClientCtx {
  username: string;
  lastSeen: number;
  intervalCheck: NodeJS.Timeout;
}

@Injectable()
export class MetricsGateway implements OnModuleDestroy {
  private wss: Wss | null = null;
  private clients = new Map<WebSocket, ClientCtx>();
  private subscription: Subscription | null = null;

  constructor(
    private readonly system: SystemService,
    private readonly auth: AuthService,
    private readonly logger: Logger,
  ) {}

  attachTo(server: HttpServer) {
    this.wss = new Wss({ noServer: true });
    server.on('upgrade', async (req, socket, head) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/ws/metrics') return;

      const authCtx = await authenticateWs(this.auth, req as IncomingMessage);
      if (!authCtx) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req as IncomingMessage, socket, head, (ws) => {
        this.onConnection(ws, authCtx.username);
      });
    });

    this.subscription = this.system.metrics$.subscribe((snapshot) => {
      const msg = JSON.stringify({ type: 'metrics', payload: snapshot });
      for (const ws of this.clients.keys()) {
        if (ws.readyState === ws.OPEN) ws.send(msg);
      }
    });

    this.logger.log('Metrics gateway attached to /ws/metrics');
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    for (const [ws, ctx] of this.clients) {
      clearInterval(ctx.intervalCheck);
      try {
        ws.close(1001, 'server shutdown');
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.wss?.close();
  }

  private onConnection(ws: WebSocket, username: string) {
    const ctx: ClientCtx = {
      username,
      lastSeen: Date.now(),
      intervalCheck: setInterval(() => {
        if (Date.now() - ctx.lastSeen > HEARTBEAT_TIMEOUT_MS) {
          try {
            ws.close(4000, 'heartbeat timeout');
          } catch {
            // ignore
          }
        }
      }, 15_000),
    };
    this.clients.set(ws, ctx);
    this.logger.log({ username, total: this.clients.size }, 'metrics client connected');

    // immediate first push if we have data
    const latest = this.system.getLatest();
    if (latest) {
      ws.send(JSON.stringify({ type: 'metrics', payload: latest }));
    }

    ws.on('message', (raw) => {
      ctx.lastSeen = Date.now();
      try {
        const data = JSON.parse(raw.toString()) as { type?: string; ts?: number };
        if (data.type === 'heartbeat') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        // ignore non-JSON
      }
    });

    const cleanup = () => {
      clearInterval(ctx.intervalCheck);
      this.clients.delete(ws);
      this.logger.log({ username, total: this.clients.size }, 'metrics client disconnected');
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  }
}
