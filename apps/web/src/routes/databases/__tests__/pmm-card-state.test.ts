import { describe, expect, it } from 'vitest';
import type { DbMetricsSummary } from '@dinopanel/shared';
import { pmmCardState } from '../pmm-card-state';

const allNullSummary: DbMetricsSummary = {
  qps: null,
  connections: null,
  uptimeSeconds: null,
  replicationLagSeconds: null,
  pmmConfigured: true,
};

const populatedSummary: DbMetricsSummary = {
  qps: 12.3,
  connections: 4,
  uptimeSeconds: 600,
  replicationLagSeconds: 0.1,
  pmmConfigured: true,
};

describe('pmmCardState', () => {
  it('returns pending while the query is in-flight', () => {
    expect(
      pmmCardState({ isPending: true, data: undefined, pmmRegistered: false }),
    ).toBe('pending');
  });

  it('returns pending when settled but data is still undefined', () => {
    expect(
      pmmCardState({ isPending: false, data: undefined, pmmRegistered: false }),
    ).toBe('pending');
  });

  it('flags not-configured when pmmConfigured is false (no PMM URL)', () => {
    expect(
      pmmCardState({
        isPending: false,
        data: { ...allNullSummary, pmmConfigured: false },
        pmmRegistered: false,
      }),
    ).toBe('not-configured');
  });

  it('flags not-registered when PMM is up but the instance was never registered', () => {
    expect(
      pmmCardState({
        isPending: false,
        data: allNullSummary,
        pmmRegistered: false,
      }),
    ).toBe('not-registered');
  });

  it('flags exporter-unhealthy when registered but PMM returns all nulls', () => {
    expect(
      pmmCardState({
        isPending: false,
        data: allNullSummary,
        pmmRegistered: true,
      }),
    ).toBe('exporter-unhealthy');
  });

  it('shows cards when at least one metric has a value', () => {
    expect(
      pmmCardState({
        isPending: false,
        data: populatedSummary,
        pmmRegistered: true,
      }),
    ).toBe('show-cards');
  });

  it('shows cards even when pmmRegistered=false as long as metrics arrive (legacy / out-of-band register)', () => {
    expect(
      pmmCardState({
        isPending: false,
        data: populatedSummary,
        pmmRegistered: false,
      }),
    ).toBe('show-cards');
  });

  it('shows cards when only some metrics are null (e.g. Redis has no replication lag)', () => {
    expect(
      pmmCardState({
        isPending: false,
        data: { ...populatedSummary, replicationLagSeconds: null },
        pmmRegistered: true,
      }),
    ).toBe('show-cards');
  });
});
