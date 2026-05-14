import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketServer as Wss } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { spawn as ptySpawn, type IPty } from 'node-pty';
import { Logger } from 'nestjs-pino';
import { AuthService } from '../auth/auth.service';
import { authenticateWs } from '../../common/guards/ws-jwt.guard';

const HEARTBEAT_TIMEOUT_MS = 90_000;
const DEFAULT_SHELL = process.env.SHELL ?? '/bin/bash';

interface Session {
  pty: IPty;
  username: string;
  lastSeen: number;
  watchdog: NodeJS.Timeout;
}

@Injectable()
export class TerminalGateway implements OnModuleDestroy {
  private wss: Wss | null = null;
  private sessions = new Map<import('ws').WebSocket, Session>();

  constructor(
    private readonly auth: AuthService,
    private readonly logger: Logger,
  ) {}

  attachTo(server: HttpServer) {
    this.wss = new Wss({ noServer: true });
    server.on('upgrade', async (req, socket, head) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/ws/terminal') return;

      const authCtx = await authenticateWs(this.auth, req as IncomingMessage);
      if (!authCtx) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const cols = Math.max(20, Math.min(500, Number(url.searchParams.get('cols')) || 80));
      const rows = Math.max(5, Math.min(200, Number(url.searchParams.get('rows')) || 24));

      this.wss!.handleUpgrade(req as IncomingMessage, socket, head, (ws) => {
        this.onConnection(ws, authCtx.username, cols, rows);
      });
    });
    this.logger.log('Terminal gateway attached to /ws/terminal');
  }

  onModuleDestroy() {
    for (const [ws, session] of this.sessions) {
      clearInterval(session.watchdog);
      try {
        session.pty.kill();
      } catch {
        // ignore
      }
      try {
        ws.close(1001, 'server shutdown');
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
    this.wss?.close();
  }

  private onConnection(ws: import('ws').WebSocket, username: string, cols: number, rows: number) {
    const pty = ptySpawn(DEFAULT_SHELL, ['-l'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME ?? '/root',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
      },
    });

    const session: Session = {
      pty,
      username,
      lastSeen: Date.now(),
      watchdog: setInterval(() => {
        if (Date.now() - session.lastSeen > HEARTBEAT_TIMEOUT_MS) {
          try {
            ws.close(4000, 'heartbeat timeout');
          } catch {
            // ignore
          }
        }
      }, 30_000),
    };
    this.sessions.set(ws, session);
    this.logger.log({ username, pid: pty.pid, total: this.sessions.size }, 'terminal opened');

    pty.onData((data: string) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });

    pty.onExit(({ exitCode, signal }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode, signal: signal ?? null }));
        ws.close(1000, 'pty exited');
      }
    });

    ws.on('message', (raw, isBinary) => {
      session.lastSeen = Date.now();
      if (isBinary) {
        pty.write(raw.toString('binary'));
        return;
      }
      const str = raw.toString();
      // JSON control frames start with '{', anything else = passthrough stdin
      if (str.startsWith('{')) {
        try {
          const ctrl = JSON.parse(str) as
            | { type: 'resize'; cols: number; rows: number }
            | { type: 'heartbeat'; ts: number };
          if (ctrl.type === 'resize') {
            pty.resize(
              Math.max(20, Math.min(500, ctrl.cols)),
              Math.max(5, Math.min(200, ctrl.rows)),
            );
            return;
          }
          if (ctrl.type === 'heartbeat') {
            ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
            return;
          }
        } catch {
          // fall through — treat as stdin
        }
      }
      pty.write(str);
    });

    const cleanup = () => {
      clearInterval(session.watchdog);
      try {
        session.pty.kill();
      } catch {
        // ignore
      }
      this.sessions.delete(ws);
      this.logger.log({ username, pid: pty.pid, total: this.sessions.size }, 'terminal closed');
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  }
}
