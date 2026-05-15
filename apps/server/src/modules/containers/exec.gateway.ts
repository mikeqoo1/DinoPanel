import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketServer as Wss } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import Dockerode from 'dockerode';
import { Logger } from 'nestjs-pino';
import { AuthService } from '../auth/auth.service';
import { authenticateWs } from '../../common/guards/ws-jwt.guard';
import { DOCKER } from './docker.token';

// Match URL: /ws/containers/<id>/exec
const PATH_RE = /^\/ws\/containers\/([^/]+)\/exec$/;

interface Session {
  username: string;
  stream: Duplex | null;
  execInstance: Dockerode.Exec | null;
}

@Injectable()
export class ExecGateway implements OnModuleDestroy {
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
      const cmd = url.searchParams.get('cmd') ?? '/bin/sh';
      const cols = Math.max(20, Math.min(500, Number(url.searchParams.get('cols')) || 80));
      const rows = Math.max(5, Math.min(200, Number(url.searchParams.get('rows')) || 24));

      this.wss!.handleUpgrade(req as IncomingMessage, socket, head, (ws) => {
        this.onConnection(ws, authCtx.username, containerId, { cmd, cols, rows });
      });
    });

    this.logger.log('Exec gateway attached to /ws/containers/:id/exec');
  }

  onModuleDestroy() {
    for (const [ws, session] of this.sessions) {
      session.stream?.destroy();
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
    opts: { cmd: string; cols: number; rows: number },
  ) {
    const session: Session = { username, stream: null, execInstance: null };
    this.sessions.set(ws, session);
    this.logger.log({ username, containerId, cmd: opts.cmd }, 'exec client connected');

    const container = this.docker.getContainer(containerId);
    const cmdParts = opts.cmd.split(' ').filter(Boolean);

    container
      .exec({
        Cmd: cmdParts,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      })
      .then((exec) => {
        session.execInstance = exec;
        return exec.start({ hijack: true, stdin: true });
      })
      .then((stream) => {
        if (ws.readyState !== ws.OPEN) {
          (stream as Duplex).destroy();
          return;
        }

        session.stream = stream as Duplex;

        (stream as Duplex).on('data', (chunk: Buffer) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(chunk);
          }
        });

        (stream as Duplex).on('end', () => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'end' }));
            ws.close(1000, 'exec ended');
          }
        });

        (stream as Duplex).on('error', (err) => {
          this.logger.error({ err, containerId }, 'exec stream error');
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'error', code: 'DOCKER_UNREACHABLE' }));
            ws.close(1011, 'stream error');
          }
        });

        ws.on('message', (raw, isBinary) => {
          if (isBinary) {
            (stream as Duplex).write(raw);
            return;
          }
          const str = raw.toString();
          if (str.startsWith('{')) {
            try {
              const ctrl = JSON.parse(str) as
                | { type: 'resize'; cols: number; rows: number }
                | { type: 'heartbeat'; ts?: number }
                | { type: string };
              if (ctrl.type === 'resize' && 'cols' in ctrl && 'rows' in ctrl) {
                const resizeCtrl = ctrl as { type: 'resize'; cols: number; rows: number };
                session.execInstance
                  ?.resize({
                    w: Math.max(20, Math.min(500, resizeCtrl.cols)),
                    h: Math.max(5, Math.min(200, resizeCtrl.rows)),
                  })
                  .catch(() => {
                    // ignore resize errors
                  });
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
          (stream as Duplex).write(str);
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
      session.stream?.destroy();
      this.sessions.delete(ws);
      this.logger.log({ username, containerId }, 'exec client disconnected');
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  }
}
