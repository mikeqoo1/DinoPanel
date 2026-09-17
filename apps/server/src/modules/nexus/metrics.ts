import type { NexusMetrics, NexusPoint, NexusRange } from '@dinopanel/shared';

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

export interface NexusSample extends Omit<NexusMetrics, 'byFormat'> {
  ts: number;
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
