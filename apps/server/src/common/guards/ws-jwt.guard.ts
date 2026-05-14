/**
 * For WebSocket connections we cannot rely on the standard NestJS guard chain
 * (the @WebSocketGateway lifecycle differs). Each gateway should call
 * `authenticateWs(authService, request)` during `handleConnection`.
 */
import type { IncomingMessage } from 'node:http';
import type { AuthService } from '../../modules/auth/auth.service';

export interface WsAuthContext {
  userId: number;
  username: string;
}

export async function authenticateWs(
  auth: AuthService,
  request: IncomingMessage,
): Promise<WsAuthContext | null> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const token = url.searchParams.get('token');
  if (!token) return null;
  try {
    const payload = await auth.verifyAccessToken(token);
    return { userId: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}
