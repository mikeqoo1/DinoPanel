import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { acmeAccounts, type AcmeAccount } from '../../database/schema';
import { AcmeClientFactory } from './acme-client.factory';

/**
 * Owns ACME account lifecycle.
 *
 * One account per `(directoryUrl, email)` pair. The private key is
 * generated lazily on first call and stored as **plain PEM** in
 * `acme_accounts.key_pem`. Encryption at rest is the operator's
 * responsibility via filesystem permissions on the SQLite DB file —
 * the same trust model used today for users.password_hash and the
 * (future) Cloudflare API token.
 *
 * A dedicated SecretsService is on the v0.4 roadmap; the schema
 * column is already correctly typed so the move can be a backfill
 * migration when that lands.
 */
@Injectable()
export class AcmeAccountService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly clients: AcmeClientFactory,
    private readonly logger: Logger,
  ) {}

  /**
   * Returns the account row for `(directoryUrl, email)`, creating both
   * the local DB row and a new ACME account on the remote directory if
   * needed. The remote `createAccount` is idempotent on the server side
   * for the same JWK, so a re-run after a partial failure is safe.
   */
  async ensureAccount(directoryUrl: string, email: string): Promise<AcmeAccount> {
    if (!email) {
      throw new InternalServerErrorException({
        code: 'ACME_EMAIL_NOT_SET',
        message:
          'ACME_EMAIL env var is empty; set it before issuing certificates',
      });
    }

    const existing = await this.db
      .select()
      .from(acmeAccounts)
      .where(
        and(
          eq(acmeAccounts.directoryUrl, directoryUrl),
          eq(acmeAccounts.email, email),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    const keyBuffer = await this.clients.crypto().createPrivateRsaKey(2048);
    const keyPem = keyBuffer.toString('utf8');

    // Register with the ACME server up-front so a misconfigured URL or
    // unreachable directory surfaces here instead of mid-issuance.
    const client = this.clients.createClient(directoryUrl, keyBuffer);
    try {
      await client.createAccount({
        contact: [`mailto:${email}`],
        termsOfServiceAgreed: true,
      });
    } catch (err) {
      this.logger.error({ err, directoryUrl, email }, 'acme.account.create_failed');
      throw new InternalServerErrorException({
        code: 'ACME_ACCOUNT_CREATE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const inserted = await this.db
      .insert(acmeAccounts)
      .values({ directoryUrl, email, keyPem })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('acme_accounts insert returned no row');
    this.logger.debug(
      { directoryUrl, email, id: row.id },
      'acme.account.created',
    );
    return row;
  }
}
