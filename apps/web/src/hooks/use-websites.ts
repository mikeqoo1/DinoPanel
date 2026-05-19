import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AcmeIssueRequest,
  AcmeStatusResponse,
  ReconcileResponse,
  SiteCreate,
  SitePatch,
  SiteResponse,
} from '@dinopanel/shared';
import { api } from '@/lib/api';

export const websiteKeys = {
  all: ['websites'] as const,
  list: () => [...websiteKeys.all, 'list'] as const,
  status: () => [...websiteKeys.all, 'status'] as const,
  conf: (id: number) => [...websiteKeys.all, 'conf', id] as const,
  ssl: (id: number) => [...websiteKeys.all, 'ssl', id] as const,
};

export interface WebsitesStatusResponse {
  degraded: boolean;
  reason: string | null;
}

export function useWebsites() {
  return useQuery<SiteResponse[]>({
    queryKey: websiteKeys.list(),
    queryFn: async () => (await api.get<SiteResponse[]>('/websites')).data,
    retry: 0,
  });
}

export function useWebsitesStatus() {
  return useQuery<WebsitesStatusResponse>({
    queryKey: websiteKeys.status(),
    queryFn: async () =>
      (await api.get<WebsitesStatusResponse>('/websites/status')).data,
    retry: 0,
  });
}

export function useWebsiteConf(id: number, enabled = true) {
  return useQuery<{ path: string; content: string }>({
    queryKey: websiteKeys.conf(id),
    queryFn: async () =>
      (await api.get<{ path: string; content: string }>(`/websites/${id}/conf`))
        .data,
    enabled,
    retry: 0,
  });
}

export function useCreateWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SiteCreate) =>
      (await api.post<SiteResponse>('/websites', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: websiteKeys.list() }),
  });
}

export function useUpdateWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: number; patch: SitePatch }) =>
      (await api.patch<SiteResponse>(`/websites/${args.id}`, args.patch)).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: websiteKeys.list() });
      qc.invalidateQueries({ queryKey: websiteKeys.conf(vars.id) });
    },
  });
}

export function useDeleteWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/websites/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: websiteKeys.list() }),
  });
}

export function useReconcileWebsites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post<ReconcileResponse>('/websites/reconcile')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: websiteKeys.list() }),
  });
}

// ---------------------------------------------------------------------------
// ACME — /api/websites/:id/ssl/*
// ---------------------------------------------------------------------------

export function useAcmeStatus(id: number, opts: { enabled?: boolean; pollMs?: number } = {}) {
  return useQuery<AcmeStatusResponse>({
    queryKey: websiteKeys.ssl(id),
    queryFn: async () =>
      (await api.get<AcmeStatusResponse>(`/websites/${id}/ssl/status`)).data,
    enabled: opts.enabled ?? true,
    refetchInterval: opts.pollMs,
    retry: 0,
  });
}

export function useAcmeIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: number; body: AcmeIssueRequest }) =>
      (await api.post<AcmeStatusResponse>(
        `/websites/${args.id}/ssl/issue`,
        args.body,
      )).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: websiteKeys.ssl(vars.id) });
      qc.invalidateQueries({ queryKey: websiteKeys.list() });
    },
  });
}

export function useAcmeRenew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.post<AcmeStatusResponse>(`/websites/${id}/ssl/renew`)).data,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: websiteKeys.ssl(id) });
      qc.invalidateQueries({ queryKey: websiteKeys.list() });
    },
  });
}

// ---------------------------------------------------------------------------
// ACME config — Cloudflare token etc.
// ---------------------------------------------------------------------------

export interface AcmeConfigResponse {
  cloudflareTokenSet: boolean;
}

export const acmeConfigKeys = {
  config: () => ['acme', 'config'] as const,
};

export function useAcmeConfig() {
  return useQuery<AcmeConfigResponse>({
    queryKey: acmeConfigKeys.config(),
    queryFn: async () =>
      (await api.get<AcmeConfigResponse>('/acme/config')).data,
    retry: 0,
  });
}

export function useSetAcmeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { cloudflareApiToken?: string | null }) =>
      (await api.put<AcmeConfigResponse>('/acme/config', patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: acmeConfigKeys.config() }),
  });
}
