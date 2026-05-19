import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { NginxService } from '../../websites/nginx.service';

/**
 * HTTP-01 challenge.
 *
 * Writes the key authorization at
 * `<acmeRoot>/.well-known/acme-challenge/<token>`. The ACME server
 * fetches `http://<domain>/.well-known/acme-challenge/<token>` — which
 * nginx serves from that same path because every site conf renders the
 * shared `location ^~ /.well-known/acme-challenge/ { root <acmeRoot>; }`
 * block (added unconditionally by `conf-renderer.ts` in Phase 1).
 *
 * No nginx reload needed: the location block was already in place from
 * the site's first creation.
 */
@Injectable()
export class Http01Challenger {
  constructor(
    private readonly nginx: NginxService,
    private readonly logger: Logger,
  ) {}

  private challengeDir(): string {
    return this.nginx.getPaths().acmeChallengeDir;
  }

  async create(token: string, keyAuthorization: string): Promise<void> {
    const dir = this.challengeDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o755 });
    const path = join(dir, this.sanitizeToken(token));
    await fs.writeFile(path, keyAuthorization, {
      encoding: 'utf8',
      mode: 0o644,
    });
    this.logger.debug({ token }, 'acme.http01.token_written');
  }

  async remove(token: string): Promise<void> {
    const path = join(this.challengeDir(), this.sanitizeToken(token));
    try {
      await fs.unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          { err, token },
          'acme.http01.token_remove_failed',
        );
      }
    }
  }

  /**
   * The ACME RFC defines tokens as `[A-Za-z0-9_-]+` (base64url alphabet).
   * Defense-in-depth: reject anything else before joining the path.
   */
  private sanitizeToken(token: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(token)) {
      throw new Error(`Invalid ACME challenge token: ${token}`);
    }
    return token;
  }
}
