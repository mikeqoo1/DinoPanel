import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketServer as Wss } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { ChildProcess } from 'node:child_process';
import { Logger } from 'nestjs-pino';
import { AuthService } from '../auth/auth.service';
import { authenticateWs } from '../../common/guards/ws-jwt.guard';
import { ComposeService } from './compose.service';

// Match URL: /ws/compose/<key>/action
const PATH_RE = /^\/ws\/compose\/([^/]+)\/action$/;

const VALID_ACTIONS = new Set(['up', 'down', 'restart', 'pull']);

interface Session {
  username: string;
  child: ChildProcess | null;
  killTimer: ReturnType<typeof setTimeout> | null;
}

@Injectable()
export class ComposeActionGateway implements OnModuleDestroy {
  private wss: Wss | null = null;
  private sessions = new Map<WebSocket, Session>();

  constructor(
    private readonly compose: ComposeService,
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

      const key = match[1]!;
      const action = url.searchParams.get('type') ?? '';

      if (!VALID_ACTIONS.has(action)) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(req as IncomingMessage, socket, head, (ws) => {
        this.onConnection(ws, authCtx.username, key, action as 'up' | 'down' | 'restart' | 'pull');
      });
    });

    this.logger.log('ComposeAction gateway attached to /ws/compose/:key/action');
  }

  onModuleDestroy() {
    for (const [ws, session] of this.sessions) {
      this.killChild(session);
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
    key: string,
    action: 'up' | 'down' | 'restart' | 'pull',
  ) {
    const session: Session = { username, child: null, killTimer: null };
    this.sessions.set(ws, session);
    this.logger.log({ username, key, action }, 'compose action client connected');

    this.compose
      .getStack(key)
      .then((stack) => {
        if (ws.readyState !== ws.OPEN) return;

        const child = this.compose.spawnAction(stack.path, action);
        session.child = child;

        // Pipe stdout and stderr to ws as binary frames (text; client renders in xterm)
        child.stdout?.on('data', (chunk: Buffer) => {
          if (ws.readyState === ws.OPEN) ws.send(chunk);
        });

        child.stderr?.on('data', (chunk: Buffer) => {
          if (ws.readyState === ws.OPEN) ws.send(chunk);
        });

        child.on('close', (code) => {
          session.child = null;
          if (session.killTimer) {
            clearTimeout(session.killTimer);
            session.killTimer = null;
          }
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'exit', code: code ?? -1 }));
            ws.close(1000, 'action completed');
          }
          this.sessions.delete(ws);
        });

        child.on('error', (err) => {
          this.logger.error({ err, key, action }, 'compose action spawn error');
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'error', code: 'SPAWN_FAILED', message: err.message }));
            ws.close(1011, 'spawn error');
          }
          this.sessions.delete(ws);
        });
      })
      .catch(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', code: 'NOT_FOUND' }));
          ws.close(1008, 'stack not found');
        }
        this.sessions.delete(ws);
      });

    const cleanup = () => {
      this.killChild(session);
      this.sessions.delete(ws);
      this.logger.log({ username, key, action }, 'compose action client disconnected');
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  }

  private killChild(session: Session) {
    const child = session.child;
    if (!child) return;
    session.child = null;

    child.kill('SIGTERM');
    session.killTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 10_000);
  }
}
