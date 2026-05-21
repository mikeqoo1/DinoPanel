import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  PmmExternalErrorReason,
  PmmExternalService,
  PmmExternalServicesResponse,
} from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { dbInstances } from '../../database/schema';
import {
  PmmInventoryClient,
  type InventoryFailureReason,
  type PmmService,
  type PmmServiceEngine,
} from '../monitoring/pmm-inventory.client';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PmmPromqlClient } from '../monitoring/pmm-promql.client';

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  result: PmmExternalServicesResponse;
  expiresAt: number;
}

/**
 * Serves the read-only "external PMM-monitored" panel under
 * /databases. Wraps PmmInventoryClient with:
 *
 * 1. Server-side dedup against `db_instances.containerName` (the
 *    DinoPanel container name is also the PMM service_name by
 *    convention — see paths.ts). Anything PMM reports that matches
 *    a managed row is filtered out, so the panel only shows DBs
 *    DinoPanel didn't create.
 *
 * 2. 30 s in-memory cache keyed on PMM URL. Refresh-button hammering
 *    doesn't bypass it; `{ refresh: true }` opt-in does.
 *
 * 3. Failure surface: keeps `services` always-present (possibly
 *    empty) and tags the error reason so the UI can pick distinct
 *    copy per failure mode without a try/catch in the controller.
 */
@Injectable()
export class ExternalPmmService implements OnModuleInit {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly inventory: PmmInventoryClient,
    private readonly promql: PmmPromqlClient,
    private readonly monitoring: MonitoringService,
  ) {}

  onModuleInit(): void {
    // Flush inventory cache when PMM URL / token / TLS posture change.
    // Cache key includes the URL so URL flips are covered by the
    // natural key miss, but token/TLS aren't in the key — observer
    // catches those.
    this.monitoring.onCredentialsChange(() => this.invalidateAll());
  }

  async list(
    opts: { refresh?: boolean } = {},
  ): Promise<PmmExternalServicesResponse> {
    const inventoryResult = await this.inventory.listServices();
    if (!inventoryResult.ok) {
      // `not_configured` is the one case where we don't want any
      // cache — flipping `monitoring.pmm_url` in settings should
      // take effect immediately. Other failure modes (auth /
      // unreachable / bad_response) also bypass the cache because
      // they're transient; we want the next request to re-probe.
      return errorResponse(mapFailure(inventoryResult.reason));
    }
    const cacheKey = await this.resolveCacheKey();
    if (!opts.refresh && cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
    }
    const managed = await this.loadManagedContainerNames();
    const services = inventoryResult.services
      .filter((s) => !managed.has(s.serviceName))
      .map(normalize);
    const result: PmmExternalServicesResponse = {
      services,
      error: null,
      fetchedAt: Date.now(),
    };
    if (cacheKey) {
      this.cache.set(cacheKey, {
        result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }
    return result;
  }

  /** Drop all entries — call when PMM settings change. */
  invalidateAll(): void {
    this.cache.clear();
  }

  private async resolveCacheKey(): Promise<string | null> {
    // Keyed on the resolved PMM URL so a URL change in settings
    // automatically invalidates the previous cache without us
    // having to wire a settings-change hook.
    const config = await this.promql.resolveConfig();
    return config.url;
  }

  private async loadManagedContainerNames(): Promise<Set<string>> {
    const rows = await this.db
      .select({ containerName: dbInstances.containerName })
      .from(dbInstances);
    return new Set(rows.map((r) => r.containerName));
  }
}

function normalize(s: PmmService): PmmExternalService {
  return {
    serviceId: s.serviceId,
    serviceName: s.serviceName,
    engine: mapEngine(s.engine),
    nodeId: s.nodeId,
    address: s.address,
    port: s.port,
  };
}

function mapEngine(
  engine: PmmServiceEngine,
): PmmExternalService['engine'] {
  // Both type unions happen to align today (mysql / mariadb /
  // postgresql / mongodb / redis / unknown), but pin the mapping
  // explicitly so future drift on either side surfaces here as a
  // type error instead of a silent miscategorization.
  switch (engine) {
    case 'mysql':
      return 'mysql';
    case 'mariadb':
      return 'mariadb';
    case 'postgresql':
      return 'postgresql';
    case 'mongodb':
      return 'mongodb';
    case 'redis':
      return 'redis';
    default:
      return 'unknown';
  }
}

function mapFailure(reason: InventoryFailureReason): PmmExternalErrorReason {
  return reason;
}

function errorResponse(
  reason: PmmExternalErrorReason,
): PmmExternalServicesResponse {
  return {
    services: [],
    error: { reason },
    fetchedAt: Date.now(),
  };
}
