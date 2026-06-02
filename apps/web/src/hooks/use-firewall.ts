import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  FirewallStatus,
  FirewallRule,
  StagedRuleResponse,
  StageFirewallRuleBody,
  Fail2banEntry,
  Fail2banJail,
  Fail2banBanBody,
} from '@dinopanel/shared';
import { api } from '@/lib/api';

export const firewallKeys = {
  all: ['firewall'] as const,
  status: () => [...firewallKeys.all, 'status'] as const,
  rules: () => [...firewallKeys.all, 'rules'] as const,
  // Shared prefix — mutations invalidate this to refresh BOTH child queries.
  fail2ban: () => [...firewallKeys.all, 'fail2ban'] as const,
  // Distinct child keys: jails and banned return different shapes, so they
  // must NOT share one cache entry.
  fail2banJails: () => [...firewallKeys.all, 'fail2ban', 'jails'] as const,
  fail2banBanned: () => [...firewallKeys.all, 'fail2ban', 'banned'] as const,
};

export function useFirewallStatus() {
  return useQuery<FirewallStatus>({
    queryKey: firewallKeys.status(),
    queryFn: async () => (await api.get<FirewallStatus>('/firewall/status')).data,
    retry: 0,
  });
}

export function useFirewallRules(enabled = true) {
  return useQuery<FirewallRule[]>({
    queryKey: firewallKeys.rules(),
    queryFn: async () => (await api.get<FirewallRule[]>('/firewall/rules')).data,
    enabled,
    retry: 0,
  });
}

export function useFirewallEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<{ ok: true }>('/firewall/enable')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function useFirewallDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<{ ok: true }>('/firewall/disable')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function useStageFirewallRule() {
  return useMutation({
    mutationFn: async (body: StageFirewallRuleBody) =>
      (await api.post<StagedRuleResponse>('/firewall/rules/stage', body)).data,
  });
}

export function useConfirmFirewallRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stagedId: number) =>
      (await api.post<{ ok: true }>(`/firewall/rules/${stagedId}/confirm`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.rules() }),
  });
}

export function useCancelFirewallRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stagedId: number) =>
      (await api.post<{ ok: true }>(`/firewall/rules/${stagedId}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.rules() }),
  });
}

export function useRemoveFirewallRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.delete<{ ok: true }>(`/firewall/rules/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.rules() }),
  });
}

export function useFail2banBanned(enabled = false) {
  return useQuery<Fail2banEntry[]>({
    queryKey: firewallKeys.fail2banBanned(),
    queryFn: async () => (await api.get<Fail2banEntry[]>('/firewall/fail2ban/banned')).data,
    enabled,
    retry: 0,
  });
}

// v0.6 toolbox Fail2Ban tab — these live here (not a new file) for module
// cohesion. Each query has its OWN key segment (jails/banned return different
// shapes); the mutations below invalidate the firewallKeys.fail2ban() prefix,
// which prefix-matches and refreshes both.
export function useFail2banJails(enabled = true) {
  return useQuery<Fail2banJail[]>({
    queryKey: firewallKeys.fail2banJails(),
    queryFn: async () => (await api.get<Fail2banJail[]>('/firewall/fail2ban/jails')).data,
    enabled,
    retry: 0,
  });
}

export function useFail2banBan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Fail2banBanBody) =>
      (await api.post<{ ok: true }>('/firewall/fail2ban/ban', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.fail2ban() }),
  });
}

export function useFail2banUnban() {
  const qc = useQueryClient();
  return useMutation({
    // unban reuses the ban body shape { jail, ip }
    mutationFn: async (body: Fail2banBanBody) =>
      (await api.post<{ ok: true }>('/firewall/fail2ban/unban', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.fail2ban() }),
  });
}

export function useFail2banSetJailEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, enabled }: { name: string; enabled: boolean }) =>
      (
        await api.post<{ ok: true }>(
          `/firewall/fail2ban/jails/${encodeURIComponent(name)}/enabled`,
          { enabled },
        )
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.fail2ban() }),
  });
}
