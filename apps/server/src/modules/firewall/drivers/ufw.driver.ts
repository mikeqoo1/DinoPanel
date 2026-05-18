import { Injectable } from '@nestjs/common';
import {
  type FirewallBackend,
  type FirewallProto,
  type FirewallAction,
} from '@dinopanel/shared';
import {
  type FirewallDriver,
  type RawRule,
} from '../firewall-driver';
import { runCommand, assertSuccess } from './run-command';

const RULE_LINE = /^\s*\[\s*\d+\]\s+(.+)$/;

@Injectable()
export class UfwDriver implements FirewallDriver {
  readonly backend: FirewallBackend = 'ufw';

  async getStatus(): Promise<{ enabled: boolean }> {
    const result = await runCommand('ufw', ['status']);
    assertSuccess(result, 'ufw status');
    return { enabled: /Status:\s*active/i.test(result.stdout) };
  }

  async enable(): Promise<void> {
    const result = await runCommand('ufw', ['--force', 'enable']);
    assertSuccess(result, 'ufw enable');
  }

  async disable(): Promise<void> {
    const result = await runCommand('ufw', ['--force', 'disable']);
    assertSuccess(result, 'ufw disable');
  }

  async listRules(): Promise<RawRule[]> {
    const result = await runCommand('ufw', ['status', 'numbered']);
    assertSuccess(result, 'ufw status numbered');
    return parseUfwRules(result.stdout);
  }

  async addRule(rule: RawRule): Promise<void> {
    const args = buildUfwArgs(rule);
    const result = await runCommand('ufw', args);
    assertSuccess(result, `ufw ${args.join(' ')}`);
  }

  async removeRule(rule: RawRule): Promise<void> {
    const args = ['delete', ...buildUfwArgs(rule)];
    const result = await runCommand('ufw', args);
    assertSuccess(result, `ufw ${args.join(' ')}`);
  }
}

/**
 * Parse `ufw status numbered`. Handles:
 *  - single-port rows: `22/tcp`, `443` (no proto → 'any')
 *  - IPv6 duplicates: `22/tcp (v6)` — collapsed (v4 row is kept; (v6)
 *    row dropped to avoid double-counting in the metadata join)
 *  - port-ranges: `8080:8090/tcp` — SKIPPED (RawRule.port is a single
 *    int; ranges are a v0.5 limitation, surfaced only via the
 *    "external" metadata-less badge if a user adds one outside the
 *    panel — but we don't render unparsed lines, so port-ranges are
 *    effectively invisible in the panel for now)
 */
export function parseUfwRules(stdout: string): RawRule[] {
  const lines = stdout.split('\n');
  const out: RawRule[] = [];
  for (const line of lines) {
    const match = RULE_LINE.exec(line);
    if (!match) continue;
    const body = match[1]!;
    // Split on 2+ spaces: [To, Action, From]
    const fields = body.split(/\s{2,}/).filter((s) => s.length > 0);
    if (fields.length < 3) continue;
    const [toRaw, actionRaw, fromRaw] = fields as [string, string, string];

    if (/\(v6\)/.test(toRaw)) continue; // skip ipv6 duplicates
    if (/:/.test(toRaw)) continue; // skip port-ranges

    const portMatch = /^(\d+)(?:\/(tcp|udp))?/.exec(toRaw.trim());
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    const proto: FirewallProto = (portMatch[2] as FirewallProto | undefined) ?? 'any';

    const actionWord = actionRaw.trim().split(/\s+/)[0]?.toUpperCase();
    const action: FirewallAction | null =
      actionWord === 'ALLOW'
        ? 'allow'
        : actionWord === 'DENY' || actionWord === 'REJECT'
          ? 'deny'
          : null;
    if (!action) continue;

    const from = fromRaw.trim();
    const source = from === 'Anywhere' || from === 'Anywhere (v6)' ? null : from;
    out.push({ port, proto, source, action });
  }
  return out;
}

export function buildUfwArgs(rule: RawRule): string[] {
  const args: string[] = [rule.action]; // 'allow' or 'deny'
  if (rule.source) {
    args.push('from', rule.source, 'to', 'any', 'port', String(rule.port));
    if (rule.proto !== 'any') args.push('proto', rule.proto);
  } else {
    args.push(rule.proto === 'any' ? String(rule.port) : `${rule.port}/${rule.proto}`);
  }
  return args;
}
