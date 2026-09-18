import type { NexusEnforcement, NexusMetrics, NexusPoint, NexusRange, NexusUsage } from '@dinopanel/shared';

// ---------------------------------------------------------------------------
// Pure functions — Prometheus text → counters → per-second rate series
// ---------------------------------------------------------------------------

/**
 * Minimal Prometheus text parser: `name value` lines only. Comments, labelled
 * series (`name{quantile="0.5",} v` — Nexus emits these for every Dropwizard
 * timer) and non-finite values are skipped. Nexus 3.96 exposes ~3500 lines and
 * every counter this module needs is unlabelled.
 */
export function parsePrometheusText(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const sp = line.indexOf(' ');
    if (sp <= 0) continue;
    const name = line.slice(0, sp);
    if (name.includes('{')) continue;
    const value = Number(line.slice(sp + 1).trim());
    if (!Number.isFinite(value)) continue;
    out.set(name, value);
  }
  return out;
}

const JETTY = 'org_eclipse_jetty_ee10_webapp_WebAppContext_';
const DOWN_PREFIX = 'bytes_downloaded_by_format_';
const UP_PREFIX = 'bytes_uploaded_by_format_';

/** Pick the handful of counters worth charting out of the full scrape. */
export function extractNexusMetrics(m: Map<string, number>): NexusMetrics {
  const n = (key: string) => m.get(key) ?? 0;
  const byFormat: Record<string, { down: number; up: number }> = {};
  const touch = (format: string) => (byFormat[format] ??= { down: 0, up: 0 });
  for (const [key, value] of m) {
    if (value <= 0) continue;
    if (key.startsWith(DOWN_PREFIX)) touch(key.slice(DOWN_PREFIX.length)).down = value;
    else if (key.startsWith(UP_PREFIX)) touch(key.slice(UP_PREFIX.length)).up = value;
  }
  let bytesDown = 0;
  let bytesUp = 0;
  for (const f of Object.values(byFormat)) {
    bytesDown += f.down;
    bytesUp += f.up;
  }
  return {
    // Community-edition write enforcement. blocked = refused outright;
    // grace_throttled = slowed while still inside the grace period.
    blockedRequests: n('nexus_analytics_blocked_requests_count'),
    throttledRequests: n('nexus_analytics_throttled_requests'),
    graceThrottledRequests: n('nexus_analytics_grace_throttled_requests'),
    requests: n(`${JETTY}requests_count`),
    resp2xx: n(`${JETTY}2xx_responses_total`),
    resp3xx: n(`${JETTY}3xx_responses_total`),
    resp4xx: n(`${JETTY}4xx_responses_total`),
    resp5xx: n(`${JETTY}5xx_responses_total`),
    bytesDown,
    bytesUp,
    byFormat,
  };
}

/**
 * Reads `/service/rest/internal/ui/usage-metrics`, the counter Sonatype's community
 * edition enforces its quota against (`requests_per_last_24h` is a rolling 24 h window,
 * not a midnight reset). Returns null for any body that does not carry a usage entry —
 * an account without access to this internal endpoint is an expected state.
 */
export function parseUsageMetrics(body: unknown): NexusUsage | null {
  if (!body || typeof body !== 'object') return null;
  const usage = (body as { usage?: unknown }).usage;
  if (!Array.isArray(usage) || usage.length === 0) return null;
  const u = usage[0] as Record<string, unknown>;
  const rates = (u['request_rates'] ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    requests24h: n(u['requests_per_last_24h']),
    componentCount: n(u['component_total_count']),
    uniqueUsers30d: n(u['unique_users_last_30d']),
    peakRequestsPerDay30d: n(rates['peak_requests_per_day_30d']),
    peakRequestsPerMinute1d: n(rates['peak_requests_per_minute_1d']),
  };
}

/** Bucket width per range, chosen so a chart gets 60–168 points. */
export function bucketMsForRange(range: NexusRange): number {
  switch (range) {
    case '1h':
      return 60_000;
    case '24h':
      return 600_000;
    case '7d':
      return 3_600_000;
  }
}

export interface NexusSample
  extends Omit<NexusMetrics, 'byFormat' | 'blockedRequests' | 'throttledRequests' | 'graceThrottledRequests'> {
  ts: number;
  /** Gauge (rolling 24 h request count); null when usage could not be read. */
  requests24h?: number | null;
  // Null on rows written before v0.6.12 and on a Nexus that does not emit them.
  blockedRequests?: number | null;
  throttledRequests?: number | null;
  graceThrottledRequests?: number | null;
}

/**
 * Summarises write enforcement over the queried samples. Returns null when no sample
 * carries the counters at all. `blockedInRange` is clamped at 0 so a restart reads as
 * "no blocking observed" rather than a negative number.
 */
export function enforcementFromSamples(samples: NexusSample[]): NexusEnforcement | null {
  const withCounters = samples.filter((s) => s.blockedRequests !== null && s.blockedRequests !== undefined);
  const last = withCounters[withCounters.length - 1];
  if (!last) return null;
  const first = withCounters[0]!;
  return {
    blocked: last.blockedRequests ?? 0,
    throttled: last.throttledRequests ?? 0,
    graceThrottled: last.graceThrottledRequests ?? 0,
    blockedInRange: Math.max(0, (last.blockedRequests ?? 0) - (first.blockedRequests ?? 0)),
  };
}

/**
 * Cumulative counters → per-second rates, one point per bucket. Because the
 * counters are cumulative, a bucket's rate is exactly
 * `(last - first) / seconds` over the samples that fall in it — no averaging.
 * A bucket whose counters went backwards (Nexus restarted) is dropped rather
 * than charted as a huge negative spike.
 */
export function toSeries(samples: NexusSample[], bucketMs: number): NexusPoint[] {
  if (samples.length < 2) return [];
  const points: NexusPoint[] = [];
  let first = samples[0]!;
  let bucket = Math.floor(first.ts / bucketMs);

  const flush = (last: NexusSample) => {
    const seconds = (last.ts - first.ts) / 1000;
    if (seconds <= 0) return;
    const rate = (a: number, b: number) => (a - b) / seconds;
    if (
      last.requests < first.requests ||
      last.bytesDown < first.bytesDown ||
      last.bytesUp < first.bytesUp
    ) {
      return; // counter reset
    }
    points.push({
      ts: last.ts,
      requests: rate(last.requests, first.requests),
      errors: rate(last.resp4xx + last.resp5xx, first.resp4xx + first.resp5xx),
      bytesDown: rate(last.bytesDown, first.bytesDown),
      bytesUp: rate(last.bytesUp, first.bytesUp),
      // Gauge, not a rate: carry the bucket's last reported value through.
      requests24h: last.requests24h ?? null,
    });
  };

  for (const sample of samples.slice(1)) {
    const b = Math.floor(sample.ts / bucketMs);
    if (b !== bucket) {
      flush(sample);
      first = sample;
      bucket = b;
    }
  }
  const last = samples[samples.length - 1]!;
  if (last.ts !== first.ts) flush(last);
  return points;
}
