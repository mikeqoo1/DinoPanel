import { Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DbMetricsSummary } from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { dbInstances, type DbInstance } from '../../database/schema';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PmmPromqlClient, type PromqlResult } from '../monitoring/pmm-promql.client';
import { DbEngineRegistry } from './db-engine.registry';

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  summary: DbMetricsSummary;
  expiresAt: number;
}

/**
 * Orchestrator that fans out the four PromQL queries from an engine's
 * driver and folds the results into a single DbMetricsSummary.
 *
 * Spec.md keeps the conceptual home on `MonitoringService.summaryFor`,
 * but the implementation lives here in the databases module — that's
 * where `DbEngineRegistry` + the row schema live, and `MonitoringService`
 * shouldn't grow per-engine knowledge.
 *
 * 30s in-memory cache (spec.md WARN-3 fix): a drawer-open across five
 * instances must not turn into 20 PromQL queries against PMM's
 * embedded Prometheus. Cache is evicted on instance delete, on PMM
 * settings change, and per-call when the caller passes
 * `{ refresh: true }`.
 */
@Injectable()
export class DbMetricsService implements OnModuleInit {
  private readonly cache = new Map<number, CacheEntry>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly pmm: PmmPromqlClient,
    private readonly registry: DbEngineRegistry,
    private readonly monitoring: MonitoringService,
  ) {}

  onModuleInit(): void {
    // Flush per-instance metric cache whenever PMM URL / token / TLS
    // posture changes — stale entries would otherwise survive a settings
    // update until the natural 30 s TTL expires.
    this.monitoring.onCredentialsChange(() => this.invalidateAll());
  }

  async summaryFor(
    instanceId: number,
    opts: { refresh?: boolean } = {},
  ): Promise<DbMetricsSummary> {
    if (!opts.refresh) {
      const cached = this.cache.get(instanceId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.summary;
      }
    }
    const row = await this.fetchRow(instanceId);
    const config = await this.pmm.resolveConfig();
    if (!config.url) {
      const summary: DbMetricsSummary = {
        qps: null,
        connections: null,
        uptimeSeconds: null,
        replicationLagSeconds: null,
        pmmConfigured: false,
      };
      // Don't cache the "not configured" answer — flipping the URL
      // in settings should take effect immediately.
      return summary;
    }
    const driver = this.registry.get(row.engine);
    const bundle = driver.promqlBundle(row.containerName);
    const [qps, connections, uptime, lag] = await Promise.all([
      this.pmm.query(bundle.qps),
      this.pmm.query(bundle.connections),
      this.pmm.query(bundle.uptimeSeconds),
      this.pmm.query(bundle.replicationLagSeconds),
    ]);
    const summary: DbMetricsSummary = {
      qps: toValue(qps),
      connections: toValue(connections),
      uptimeSeconds: toValue(uptime),
      replicationLagSeconds: toValue(lag),
      pmmConfigured: true,
    };
    this.cache.set(instanceId, {
      summary,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return summary;
  }

  /** Drop the cache entry for an instance — call on delete + rotate. */
  invalidate(instanceId: number): void {
    this.cache.delete(instanceId);
  }

  /** Drop all entries — call when PMM settings change. */
  invalidateAll(): void {
    this.cache.clear();
  }

  private async fetchRow(id: number): Promise<DbInstance> {
    const rows = await this.db
      .select()
      .from(dbInstances)
      .where(eq(dbInstances.id, id))
      .limit(1);
    if (!rows[0]) {
      throw new NotFoundException({
        code: 'DB_INSTANCE_NOT_FOUND',
        message: `No db instance with id ${id}`,
      });
    }
    return rows[0];
  }
}

function toValue(result: PromqlResult): number | null {
  return result.ok ? result.value : null;
}
