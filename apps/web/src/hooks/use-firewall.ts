import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  FirewallStatus,
  FirewallRule,
  StagedRuleResponse,
  StageFirewallRuleBody,
  Fail2banEntry,
} from '@dinopanel/shared';
import { api } from '@/lib/api';

export const firewallKeys = {
  all: ['firewall'] as const,
  status: () => [...firewallKeys.all, 'status'] as const,
  rules: () => [...firewallKeys.all, 'rules'] as const,
  fail2ban: () => [...firewallKeys.all, 'fail2ban'] as const,
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
    queryKey: firewallKeys.fail2ban(),
    queryFn: async () => (await api.get<Fail2banEntry[]>('/firewall/fail2ban/banned')).data,
    enabled,
    retry: 0,
  });
}
