import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { eq } from 'drizzle-orm';
import type {
  AcmeChallenge,
  AcmeDnsProvider,
  AcmeStatusResponse,
  SiteCertInfo,
} from '@dinopanel/shared';
import type { AppConfig } from '../../config/configuration';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { acmeOrders, settings, sites } from '../../database/schema';
import { NginxService } from '../websites/nginx.service';
import { SitesService } from '../websites/sites.service';
import { AcmeAccountService } from './acme-account.service';
import {
  AcmeClientFactory,
  type AcmeClient,
} from './acme-client.factory';
import {
  CloudflareDns01Challenger,
} from './challengers/cloudflare-dns01.challenger';
import { Http01Challenger } from './challengers/http01.challenger';

export interface IssueArgs {
  siteId: number;
  domains: string[];
  challenge: AcmeChallenge;
  dnsProvider?: AcmeDnsProvider;
}

export interface IssueResult {
  cert: SiteCertInfo;
  expiresAt: number;
}

interface CertWriteResult {
  fullchainPath: string;
  privkeyPath: string;
  expiresAt: number;
}

@Injectable()
export class AcmeOrchestratorService {
  private readonly directoryUrl: string;
  // v0.4: ACME_EMAIL moved from constructor-resolved to per-call lookup.
  // Env wins; settings['acme.email'] is the fallback (decisions Q4
  // carry-over from v0.3). The old `email` field became state that
  // wouldn't reflect operator UI changes without a restart.

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(ConfigService)
    config: ConfigService<{ app: AppConfig }>,
    private readonly accounts: AcmeAccountService,
    private readonly clients: AcmeClientFactory,
    private readonly http01: Http01Challenger,
    private readonly dns01: CloudflareDns01Challenger,
    private readonly nginx: NginxService,
    private readonly sites: SitesService,
    private readonly logger: Logger,
  ) {
    const app = config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    this.directoryUrl = app.env.ACME_DIRECTORY_URL;
    this.envEmail = app.env.ACME_EMAIL;
  }

  private readonly envEmail: string;

  /**
   * Resolve the email address for ACME registration. Env wins;
   * settings['acme.email'] is the fallback (v0.4 carry-over). Throws
   * `ACME_EMAIL_MISSING` if neither is set so the caller can surface
   * a clear "configure your email" prompt instead of an opaque ACME
   * server rejection.
   */
  async getEmail(): Promise<string> {
    const env = this.envEmail.trim();
    if (env) return env;
    const row = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'acme.email'))
      .limit(1);
    const settingsEmail = row[0]?.value?.trim();
    if (settingsEmail) return settingsEmail;
    throw new InternalServerErrorException({
      code: 'ACME_EMAIL_MISSING',
      message:
        'ACME email not configured — set ACME_EMAIL env or write settings.acme.email before issuing certificates',
    });
  }

  async status(siteId: number): Promise<AcmeStatusResponse> {
    const site = await this.findSite(siteId);
    const lastOrder = await this.db
      .select()
      .from(acmeOrders)
      .where(eq(acmeOrders.siteId, siteId))
      .orderBy(acmeOrders.startedAt)
      .limit(1);
    const last = lastOrder[0];
    return {
      hasCert: site.certPaths !== null,
      expiresAt: site.certExpiresAt,
      lastIssuedAt: last?.status === 'success' ? last.finishedAt : null,
      lastError:
        last?.status === 'failed' ? last.errorMessage ?? 'unknown' : null,
    };
  }

  async issue(args: IssueArgs): Promise<IssueResult> {
    return this.runIssuance(args, 'issue');
  }

  /**
   * Convenience wrapper: derive `domains` from the site row's primary
   * domain. SAN / multi-domain certs are a future-release item; the
   * controller path goes through this method so the body can stay
   * minimal (`{ challenge, dnsProvider? }`).
   */
  async issueForSite(
    siteId: number,
    challenge: AcmeChallenge,
    dnsProvider?: AcmeDnsProvider,
  ): Promise<IssueResult> {
    const site = await this.findSite(siteId);
    return this.runIssuance(
      { siteId, domains: [site.primaryDomain], challenge, dnsProvider },
      'issue',
    );
  }

  async renew(siteId: number): Promise<IssueResult> {
    const site = await this.findSite(siteId);
    // Re-use the same challenge type that successfully issued before
    // (recorded on the most recent successful order).
    const lastSuccess = await this.db
      .select()
      .from(acmeOrders)
      .where(eq(acmeOrders.siteId, siteId))
      .orderBy(acmeOrders.startedAt)
      .limit(1);
    const challenge: 'http-01' | 'dns-01' =
      lastSuccess[0]?.challenge ?? 'http-01';
    return this.runIssuance(
      {
        siteId,
        domains: [site.primaryDomain],
        challenge,
        // dnsProvider only relevant for DNS-01; default to cloudflare
        // since that's the only one v0.3 ships.
        dnsProvider: challenge === 'dns-01' ? 'cloudflare' : undefined,
      },
      'renew',
    );
  }

  private async runIssuance(
    args: IssueArgs,
    op: 'issue' | 'renew',
  ): Promise<IssueResult> {
    if (args.domains.length === 0) {
      throw new BadRequestException({ code: 'ACME_NO_DOMAINS' });
    }
    if (args.challenge === 'dns-01' && args.dnsProvider !== 'cloudflare') {
      throw new BadRequestException({
        code: 'ACME_DNS_PROVIDER_UNSUPPORTED',
        message: 'v0.3 only supports the cloudflare DNS provider',
      });
    }
    const site = await this.findSite(args.siteId);

    const startedAt = Date.now();
    const orderInsert = await this.db
      .insert(acmeOrders)
      .values({
        siteId: site.id,
        challenge: args.challenge,
        status: 'pending',
        startedAt,
      })
      .returning({ id: acmeOrders.id });
    const orderId = orderInsert[0]?.id;
    if (orderId === undefined) throw new Error('acme_orders insert failed');

    try {
      // v0.4: resolve email per-call (env wins, settings fallback,
      // throws ACME_EMAIL_MISSING on neither).
      const email = await this.getEmail();
      const account = await this.accounts.ensureAccount(
        this.directoryUrl,
        email,
      );
      const client = this.clients.createClient(
        this.directoryUrl,
        Buffer.from(account.keyPem, 'utf8'),
      );
      const cryptoApi = this.clients.crypto();

      const [keyBuf, csrBuf] = await cryptoApi.createCsr({
        commonName: args.domains[0]!,
        altNames: args.domains.slice(1),
      });

      const dns01StateByDomain = new Map<
        string,
        { recordId: string; zoneId: string }
      >();

      const certPem = await this.runAutoFlow(
        client,
        csrBuf,
        args.challenge,
        dns01StateByDomain,
        email,
      );

      const written = await this.writeCertFiles(site.id, keyBuf, certPem);
      await this.recordCertOnSite(site.id, written);
      await this.regenerateConfWithCert(site.id, {
        fullchainPath: written.fullchainPath,
        privkeyPath: written.privkeyPath,
      });

      await this.db
        .update(acmeOrders)
        .set({
          status: 'success',
          finishedAt: Date.now(),
        })
        .where(eq(acmeOrders.id, orderId));

      this.logger.debug(
        { siteId: site.id, op, expiresAt: written.expiresAt },
        'acme.issue.success',
      );

      return {
        cert: {
          fullchainPath: written.fullchainPath,
          privkeyPath: written.privkeyPath,
        },
        expiresAt: written.expiresAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db
        .update(acmeOrders)
        .set({
          status: 'failed',
          errorMessage: message.slice(0, 1024),
          finishedAt: Date.now(),
        })
        .where(eq(acmeOrders.id, orderId));
      this.logger.error({ err, siteId: site.id, op }, 'acme.issue.failed');
      throw err;
    }
  }

  private async runAutoFlow(
    client: AcmeClient,
    csrBuf: Buffer,
    challenge: AcmeChallenge,
    dns01State: Map<string, { recordId: string; zoneId: string }>,
    email: string,
  ): Promise<string> {
    return client.auto({
      csr: csrBuf,
      challengePriority: [challenge],
      email,
      termsOfServiceAgreed: true,
      challengeCreateFn: async (authz, ch, keyAuthorization) => {
        const dom = authz.identifier?.value ?? '';
        if (ch.type === 'http-01') {
          await this.http01.create(ch.token, keyAuthorization);
        } else if (ch.type === 'dns-01') {
          const state = await this.dns01.create(dom, keyAuthorization);
          dns01State.set(dom, state);
        } else {
          throw new Error(`Unsupported challenge type: ${ch.type}`);
        }
      },
      challengeRemoveFn: async (authz, ch) => {
        const dom = authz.identifier?.value ?? '';
        if (ch.type === 'http-01') {
          await this.http01.remove(ch.token);
        } else if (ch.type === 'dns-01') {
          const state = dns01State.get(dom);
          if (state) await this.dns01.remove(state);
          dns01State.delete(dom);
        }
      },
    });
  }

  private async writeCertFiles(
    siteId: number,
    keyBuf: Buffer,
    certPem: string,
  ): Promise<CertWriteResult> {
    const dir = this.nginx.acmeCertDir(siteId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const fullchainPath = join(dir, 'fullchain.pem');
    const privkeyPath = join(dir, 'privkey.pem');
    await fs.writeFile(fullchainPath, certPem, { encoding: 'utf8', mode: 0o644 });
    await fs.writeFile(privkeyPath, keyBuf, { encoding: 'utf8', mode: 0o600 });

    const info = this.clients.crypto().readCertificateInfo(certPem);
    return {
      fullchainPath,
      privkeyPath,
      expiresAt: info.notAfter.getTime(),
    };
  }

  private async recordCertOnSite(
    siteId: number,
    written: CertWriteResult,
  ): Promise<void> {
    const cert: SiteCertInfo = {
      fullchainPath: written.fullchainPath,
      privkeyPath: written.privkeyPath,
    };
    await this.db
      .update(sites)
      .set({
        certPaths: cert,
        certExpiresAt: written.expiresAt,
        updatedAt: Date.now(),
      })
      .where(eq(sites.id, siteId));
  }

  private async regenerateConfWithCert(
    siteId: number,
    cert: SiteCertInfo,
  ): Promise<void> {
    // Reuse SitesService.update with an empty patch so the renderer picks
    // up the new cert from the DB and re-emits the conf with the SSL
    // listen + ssl_certificate directives.
    void cert; // metadata write above already attaches it
    await this.sites.update(siteId, {});
  }

  private async findSite(siteId: number): Promise<typeof sites.$inferSelect> {
    const rows = await this.db
      .select()
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException({ code: 'SITE_NOT_FOUND' });
    return rows[0];
  }
}
