import type { DbMetricsSummary } from '@dinopanel/shared';

export type PmmCardState =
  | 'pending'
  | 'not-configured'
  | 'not-registered'
  | 'exporter-unhealthy'
  | 'show-cards';

export interface PmmCardStateInput {
  isPending: boolean;
  data: DbMetricsSummary | undefined;
  pmmRegistered: boolean;
}

export function pmmCardState({ isPending, data, pmmRegistered }: PmmCardStateInput): PmmCardState {
  if (isPending) return 'pending';
  if (data?.pmmConfigured === false) return 'not-configured';
  if (!data) return 'pending';
  const allNull =
    data.qps == null &&
    data.connections == null &&
    data.uptimeSeconds == null &&
    data.replicationLagSeconds == null;
  if (allNull) {
    return pmmRegistered ? 'exporter-unhealthy' : 'not-registered';
  }
  return 'show-cards';
}
