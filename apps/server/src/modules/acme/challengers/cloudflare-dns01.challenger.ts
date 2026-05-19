import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, type Db } from '../../../database/db.module';
import { settings } from '../../../database/schema';

const CF_BASE = 'https://api.cloudflare.com/client/v4';
const CF_TOKEN_KEY = 'acme.cloudflare.api_token';

const PROPAGATION_POLL_INTERVAL_MS = 10_000;
const PROPAGATION_MAX_ATTEMPTS = 30;

export interface PropagationPoller {
  /** Returns true once the TXT record is visible. */
  isVisible(name: string, expected: string): Promise<boolean>;
}

/** Production poller — checks Cloudflare's resolver via DNS-over-HTTPS. */
@Injectable()
export class CloudflareDohPropagationPoller implements PropagationPoller {
  async isVisible(name: string, expected: string): Promise<boolean> {
    try {
      const res = await fetch(
        `https://1.1.1.1/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
        { headers: { accept: 'application/dns-json' } },
      );
      if (!res.ok) return false;
      const json = (await res.json()) as { Answer?: { data?: string }[] };
      const answers = json.Answer ?? [];
      return answers.some((a) =>
        typeof a.data === 'string' && a.data.includes(expected),
      );
    } catch {
      return false;
    }
  }
}

export const PROPAGATION_POLLER = Symbol('PROPAGATION_POLLER');

interface CfZone {
  id: string;
  name: string;
}

interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

/**
 * DNS-01 via Cloudflare.
 *
 * Flow on `create()`:
 *  1. Resolve the zone that hosts `<domain>` via `GET /zones?name=…`.
 *     Walks the apex labels if the immediate domain isn't a zone
 *     (`www.example.com` → `example.com`).
 *  2. POST a `TXT` record at `_acme-challenge.<domain>` with the
 *     base64url-encoded SHA-256 digest of the key authorization.
 *  3. Poll public DNS until the record is visible OR the timeout
 *     expires (default 30 × 10 s = 5 minutes — well above CF's typical
 *     few-second propagation).
 *
 * `remove()` deletes the record by id (which `create()` stashes on
 * the returned state object).
 */
@Injectable()
export class CloudflareDns01Challenger {
  // Override-able for tests via a setter (rather than ctor) so the
  // factory provider stays simple in the module.
  private propagationIntervalMs = PROPAGATION_POLL_INTERVAL_MS;
  private propagationMaxAttempts = PROPAGATION_MAX_ATTEMPTS;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(PROPAGATION_POLLER) private readonly poller: PropagationPoller,
    private readonly logger: Logger,
  ) {}

  /** Tunable for tests so we don't wait minutes on CI. */
  setPropagationTuning(intervalMs: number, maxAttempts: number): void {
    this.propagationIntervalMs = intervalMs;
    this.propagationMaxAttempts = maxAttempts;
  }

  async create(
    domain: string,
    keyAuthorization: string,
  ): Promise<{ recordId: string; zoneId: string; recordName: string }> {
    const token = await this.requireToken();
    const zone = await this.findZone(domain, token);
    const recordName = `_acme-challenge.${domain}`;
    const expected = dns01Digest(keyAuthorization);
    const record = await this.createTxt(zone.id, recordName, expected, token);
    this.logger.debug(
      { recordId: record.id, zoneId: zone.id, recordName },
      'acme.dns01.txt_created',
    );
    await this.waitForPropagation(recordName, expected);
    return { recordId: record.id, zoneId: zone.id, recordName };
  }

  async remove(state: { recordId: string; zoneId: string }): Promise<void> {
    const token = await this.requireToken();
    const res = await fetch(
      `${CF_BASE}/zones/${state.zoneId}/dns_records/${state.recordId}`,
      { method: 'DELETE', headers: this.authHeaders(token) },
    );
    if (!res.ok) {
      this.logger.warn(
        { status: res.status, ...state },
        'acme.dns01.txt_remove_failed',
      );
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async requireToken(): Promise<string> {
    const rows = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, CF_TOKEN_KEY))
      .limit(1);
    const token = rows[0]?.value;
    if (!token) {
      throw new Error(
        'Cloudflare API token not set — POST it to /api/settings via key ' +
          CF_TOKEN_KEY,
      );
    }
    return token;
  }

  private authHeaders(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };
  }

  private async findZone(domain: string, token: string): Promise<CfZone> {
    const labels = domain.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = labels.slice(i).join('.');
      const res = await fetch(
        `${CF_BASE}/zones?name=${encodeURIComponent(candidate)}`,
        { headers: this.authHeaders(token) },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { result?: CfZone[] };
      if (json.result && json.result.length > 0) {
        return json.result[0]!;
      }
    }
    throw new Error(`Cloudflare zone for "${domain}" not found`);
  }

  private async createTxt(
    zoneId: string,
    name: string,
    content: string,
    token: string,
  ): Promise<CfRecord> {
    const res = await fetch(`${CF_BASE}/zones/${zoneId}/dns_records`, {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify({ type: 'TXT', name, content, ttl: 60 }),
    });
    const json = (await res.json()) as { success: boolean; result?: CfRecord; errors?: unknown };
    if (!res.ok || !json.success || !json.result) {
      throw new Error(
        `Cloudflare TXT create failed: status ${res.status}, body ${JSON.stringify(json)}`,
      );
    }
    return json.result;
  }

  private async waitForPropagation(name: string, expected: string): Promise<void> {
    for (let attempt = 0; attempt < this.propagationMaxAttempts; attempt++) {
      if (await this.poller.isVisible(name, expected)) {
        this.logger.debug({ name, attempt }, 'acme.dns01.propagated');
        return;
      }
      await sleep(this.propagationIntervalMs);
    }
    throw new Error(
      `DNS-01 TXT record at ${name} did not propagate within ${
        (this.propagationIntervalMs * this.propagationMaxAttempts) / 1000
      }s`,
    );
  }
}

/**
 * RFC 8555 §8.4: DNS-01 challenge value is `base64url(sha256(keyAuth))`.
 * Exported for tests.
 */
export function dns01Digest(keyAuthorization: string): string {
  return createHash('sha256')
    .update(keyAuthorization)
    .digest('base64url');
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
