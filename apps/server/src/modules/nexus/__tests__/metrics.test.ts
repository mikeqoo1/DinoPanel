import { describe, it, expect } from 'vitest';
import { parsePrometheusText, extractNexusMetrics, toSeries, bucketMsForRange, parseUsageMetrics, enforcementFromSamples } from '../metrics';

const SAMPLE_TEXT = `# HELP jvm_memory_heap_committed Generated from Dropwizard metric
# TYPE jvm_memory_heap_committed gauge
jvm_memory_heap_committed 2.835349504E9
org_sonatype_nexus_coreui_SearchComponent_read_timer{quantile="0.5",} 3.2511E-5
org_eclipse_jetty_ee10_webapp_WebAppContext_requests_count 15802.0
org_eclipse_jetty_ee10_webapp_WebAppContext_1xx_responses_total 0.0
org_eclipse_jetty_ee10_webapp_WebAppContext_2xx_responses_total 15607.0
org_eclipse_jetty_ee10_webapp_WebAppContext_3xx_responses_total 187.0
org_eclipse_jetty_ee10_webapp_WebAppContext_4xx_responses_total 8.0
org_eclipse_jetty_ee10_webapp_WebAppContext_5xx_responses_total 0.0
bytes_downloaded_by_format_npm 3.26405912E9
bytes_downloaded_by_format_maven2 1024.0
bytes_downloaded_by_format_docker 0.0
bytes_uploaded_by_format_npm 512.0
nexus_analytics_blocked_requests_count 7.0
nexus_analytics_throttled_requests 0.0
nexus_analytics_grace_throttled_requests 0.0
broken_line_without_value
some_metric NaN
`;

describe('parsePrometheusText', () => {
  it('parses plain name/value lines including scientific notation', () => {
    const m = parsePrometheusText(SAMPLE_TEXT);
    expect(m.get('jvm_memory_heap_committed')).toBe(2835349504);
    expect(m.get('org_eclipse_jetty_ee10_webapp_WebAppContext_requests_count')).toBe(15802);
  });

  it('skips comments, labelled series, malformed lines and NaN', () => {
    const m = parsePrometheusText(SAMPLE_TEXT);
    expect(m.has('# HELP jvm_memory_heap_committed')).toBe(false);
    expect(m.has('org_sonatype_nexus_coreui_SearchComponent_read_timer')).toBe(false);
    expect(m.has('broken_line_without_value')).toBe(false);
    expect(m.has('some_metric')).toBe(false);
  });

  it('returns an empty map for empty input', () => {
    expect(parsePrometheusText('').size).toBe(0);
  });
});

describe('extractNexusMetrics', () => {
  it('pulls request/response counters and sums bytes across formats', () => {
    const r = extractNexusMetrics(parsePrometheusText(SAMPLE_TEXT));
    expect(r.requests).toBe(15802);
    expect(r.resp2xx).toBe(15607);
    expect(r.resp3xx).toBe(187);
    expect(r.resp4xx).toBe(8);
    expect(r.resp5xx).toBe(0);
    expect(r.bytesDown).toBe(3264059120 + 1024);
    expect(r.bytesUp).toBe(512);
  });

  it('keeps only formats with traffic, as a down/up pair', () => {
    const r = extractNexusMetrics(parsePrometheusText(SAMPLE_TEXT));
    expect(r.byFormat).toEqual({
      npm: { down: 3264059120, up: 512 },
      maven2: { down: 1024, up: 0 },
    });
  });

  it('picks up the write-enforcement counters', () => {
    const r = extractNexusMetrics(parsePrometheusText(SAMPLE_TEXT));
    expect(r.blockedRequests).toBe(7);
    expect(r.throttledRequests).toBe(0);
    expect(r.graceThrottledRequests).toBe(0);
  });

  it('missing counters read as 0 rather than throwing', () => {
    const r = extractNexusMetrics(new Map());
    expect(r).toMatchObject({ requests: 0, resp5xx: 0, bytesDown: 0, bytesUp: 0, byFormat: {}, blockedRequests: 0 });
  });
});

describe('bucketMsForRange', () => {
  it('maps each range to a bucket that yields a chart-sized series', () => {
    expect(bucketMsForRange('1h')).toBe(60_000);
    expect(bucketMsForRange('24h')).toBe(600_000);
    expect(bucketMsForRange('7d')).toBe(3_600_000);
  });
});

const BASE = 1_700_000_000_000;
const s = (tsOffsetSec: number, requests: number, bytesDown: number, extra: Partial<{ bytesUp: number; resp4xx: number; resp5xx: number }> = {}) => ({
  ts: BASE + tsOffsetSec * 1000,
  requests,
  resp2xx: 0,
  resp3xx: 0,
  resp4xx: extra.resp4xx ?? 0,
  resp5xx: extra.resp5xx ?? 0,
  bytesDown,
  bytesUp: extra.bytesUp ?? 0,
});

describe('toSeries', () => {
  it('turns cumulative counters into per-second rates over one bucket', () => {
    // 60s apart, +120 requests, +60 MB → 2 req/s, 1 MB/s
    const points = toSeries([s(0, 1000, 0), s(60, 1120, 60 * 1024 * 1024)], 60_000);
    expect(points).toHaveLength(1);
    expect(points[0]!.requests).toBeCloseTo(2, 6);
    expect(points[0]!.bytesDown).toBeCloseTo(1024 * 1024, 6);
    expect(points[0]!.ts).toBe(BASE + 60_000);
  });

  it('emits one point per bucket and carries the bucket boundary sample over', () => {
    const points = toSeries(
      [s(0, 0, 0), s(60, 60, 0), s(120, 180, 0)],
      60_000,
    );
    expect(points).toHaveLength(2);
    expect(points[0]!.requests).toBeCloseTo(1, 6);
    expect(points[1]!.requests).toBeCloseTo(2, 6);
  });

  it('skips a bucket where a counter went backwards (Nexus restarted)', () => {
    const points = toSeries([s(0, 5000, 0), s(60, 10, 0), s(120, 130, 0)], 60_000);
    expect(points).toHaveLength(1);
    expect(points[0]!.ts).toBe(BASE + 120_000);
    expect(points[0]!.requests).toBeCloseTo(2, 6);
  });

  it('counts 4xx and 5xx together as the error rate', () => {
    const points = toSeries([s(0, 0, 0), s(60, 0, 0, { resp4xx: 30, resp5xx: 30 })], 60_000);
    expect(points[0]!.errors).toBeCloseTo(1, 6);
  });

  it('returns [] for fewer than two samples', () => {
    expect(toSeries([], 60_000)).toEqual([]);
    expect(toSeries([s(0, 1, 1)], 60_000)).toEqual([]);
  });

  it('ignores a zero-length interval instead of dividing by zero', () => {
    const points = toSeries([s(0, 10, 0), s(0, 20, 0)], 60_000);
    expect(points.every((p) => Number.isFinite(p.requests))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseUsageMetrics — /service/rest/internal/ui/usage-metrics (community quota)
// ---------------------------------------------------------------------------

const USAGE_BODY = {
  usage: [
    {
      date: '2026-09-17',
      component_total_count: 16458,
      unique_users_last_30d: 3,
      peak_component_total_count_per_day_30d: 16437,
      requests_per_last_24h: 195563,
      aggregated_components_count: 16458,
      request_rates: { peak_requests_per_minute_1d: 7440, peak_requests_per_day_30d: 353057 },
    },
  ],
};

describe('parseUsageMetrics', () => {
  it('pulls the quota-relevant figures out of the usage array', () => {
    expect(parseUsageMetrics(USAGE_BODY)).toEqual({
      requests24h: 195563,
      componentCount: 16458,
      uniqueUsers30d: 3,
      peakRequestsPerDay30d: 353057,
      peakRequestsPerMinute1d: 7440,
    });
  });

  it('returns null for a body without a usage entry', () => {
    expect(parseUsageMetrics({ usage: [] })).toBeNull();
    expect(parseUsageMetrics({})).toBeNull();
    expect(parseUsageMetrics(null)).toBeNull();
    expect(parseUsageMetrics('nope')).toBeNull();
  });

  it('missing nested rates read as 0 rather than throwing', () => {
    const r = parseUsageMetrics({ usage: [{ requests_per_last_24h: 10, component_total_count: 2, unique_users_last_30d: 1 }] });
    expect(r).toEqual({ requests24h: 10, componentCount: 2, uniqueUsers30d: 1, peakRequestsPerDay30d: 0, peakRequestsPerMinute1d: 0 });
  });
});

describe('toSeries — usage gauge', () => {
  const g = (tsOffsetSec: number, requests24h: number | null) => ({
    ts: BASE + tsOffsetSec * 1000,
    requests: tsOffsetSec,
    resp2xx: 0,
    resp3xx: 0,
    resp4xx: 0,
    resp5xx: 0,
    bytesDown: 0,
    bytesUp: 0,
    requests24h,
  });

  it('carries the bucket\'s last requests24h gauge onto the point', () => {
    const points = toSeries([g(0, 100), g(30, 150), g(60, 200)], 60_000);
    expect(points[0]!.requests24h).toBe(200);
  });

  it('is null when the instance never reported usage', () => {
    const points = toSeries([g(0, null), g(60, null)], 60_000);
    expect(points[0]!.requests24h).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// enforcementFromSamples — is Nexus refusing writes, and did it just now?
// ---------------------------------------------------------------------------

describe('enforcementFromSamples', () => {
  const e = (tsOffsetSec: number, blocked: number | null, grace = 0) => ({
    ts: BASE + tsOffsetSec * 1000,
    requests: 0,
    resp2xx: 0,
    resp3xx: 0,
    resp4xx: 0,
    resp5xx: 0,
    bytesDown: 0,
    bytesUp: 0,
    blockedRequests: blocked,
    graceThrottledRequests: grace,
    throttledRequests: 0,
  });

  it('reports the latest totals and how much blocking happened inside the window', () => {
    expect(enforcementFromSamples([e(0, 4), e(60, 7)])).toEqual({
      blocked: 7,
      throttled: 0,
      graceThrottled: 0,
      blockedInRange: 3,
    });
  });

  it('a counter that never moved reports blockedInRange 0 but keeps the total', () => {
    expect(enforcementFromSamples([e(0, 7), e(60, 7)])?.blockedInRange).toBe(0);
    expect(enforcementFromSamples([e(0, 7), e(60, 7)])?.blocked).toBe(7);
  });

  it('a restart (counter went backwards) reports the new total, never a negative delta', () => {
    const r = enforcementFromSamples([e(0, 7), e(60, 2)]);
    expect(r).toMatchObject({ blocked: 2, blockedInRange: 0 });
  });

  it('carries the grace counter through, which distinguishes grace from hard enforcement', () => {
    expect(enforcementFromSamples([e(0, 0, 5), e(60, 0, 9)])?.graceThrottled).toBe(9);
  });

  it('is null when no sample carries the counters (pre-0.6.12 rows or an older Nexus)', () => {
    expect(enforcementFromSamples([e(0, null), e(60, null)])).toBeNull();
    expect(enforcementFromSamples([])).toBeNull();
  });

  it('works from a single sample', () => {
    expect(enforcementFromSamples([e(0, 7)])).toEqual({ blocked: 7, throttled: 0, graceThrottled: 0, blockedInRange: 0 });
  });
});
