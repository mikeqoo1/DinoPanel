import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { sessions, loginAttempts, type User } from '../../database/schema';
import { UsersService } from '../users/users.service';
import type { AppConfig } from '../../config/configuration';

type LoginFailReason = 'unknown_user' | 'bad_password';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AccessPayload {
  sub: number;
  username: string;
}

interface RefreshPayload {
  sub: number;
  jti: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<{ app: AppConfig }>,
    private readonly logger: Logger,
  ) {}

  private get cfg(): AppConfig {
    const c = this.config.get<AppConfig>('app', { infer: true });
    if (!c) throw new Error('App config missing');
    return c;
  }

  async login(
    username: string,
    password: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<{ tokens: TokenPair; user: User }> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      await this.recordAttempt(username, 'fail', 'unknown_user', meta);
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await this.users.verifyPassword(user, password);
    if (!ok) {
      await this.recordAttempt(username, 'fail', 'bad_password', meta);
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user, meta);
    await this.recordAttempt(username, 'success', null, meta);
    return { tokens, user };
  }

  private async recordAttempt(
    username: string,
    result: 'success' | 'fail',
    reason: LoginFailReason | null,
    meta: { userAgent?: string; ip?: string },
  ): Promise<void> {
    try {
      await this.db.insert(loginAttempts).values({
        username,
        result,
        reason,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    } catch (err) {
      this.logger.warn({ err, username }, 'auth.login_attempt_write_failed');
    }
  }

  async refresh(
    refreshToken: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<TokenPair> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.cfg.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, payload.jti),
    });
    if (!session || session.expiresAt < Date.now()) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    const user = await this.users.findById(session.userId);
    if (!user) throw new UnauthorizedException('User no longer exists');

    // rotate: delete old, create new
    await this.db.delete(sessions).where(eq(sessions.id, session.id));
    return this.issueTokens(user, meta);
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.cfg.env.JWT_SECRET,
      });
      await this.db.delete(sessions).where(eq(sessions.id, payload.jti));
    } catch {
      // ignore — logout is best-effort
    }
  }

  async verifyAccessToken(token: string): Promise<AccessPayload> {
    return this.jwt.verifyAsync<AccessPayload>(token, {
      secret: this.cfg.env.JWT_SECRET,
    });
  }

  private async issueTokens(
    user: User,
    meta: { userAgent?: string; ip?: string },
  ): Promise<TokenPair> {
    const jti = randomBytes(32).toString('hex');

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username },
      {
        secret: this.cfg.env.JWT_SECRET,
        expiresIn: this.cfg.env.JWT_ACCESS_TTL as unknown as number,
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti },
      {
        secret: this.cfg.env.JWT_SECRET,
        expiresIn: this.cfg.env.JWT_REFRESH_TTL as unknown as number,
      },
    );

    const refreshExpMs = parseTtl(this.cfg.env.JWT_REFRESH_TTL);
    await this.db.insert(sessions).values({
      id: jti,
      userId: user.id,
      expiresAt: Date.now() + refreshExpMs,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });

    // best-effort cleanup of expired sessions
    this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, Date.now()))
      .catch?.(() => undefined);

    return { accessToken, refreshToken };
  }
}

function parseTtl(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) {
    const asNum = Number(s);
    if (!Number.isFinite(asNum)) throw new Error(`Invalid TTL: ${s}`);
    return asNum * 1000;
  }
  const n = Number(m[1]);
  const unit = m[2] as 's' | 'm' | 'h' | 'd';
  const mult: Record<'s' | 'm' | 'h' | 'd', number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return n * mult[unit];
}
