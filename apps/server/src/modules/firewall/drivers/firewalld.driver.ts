import { Injectable } from '@nestjs/common';
import {
  type FirewallBackend,
  type FirewallProto,
  type FirewallAction,
} from '@dinopanel/shared';
import { type FirewallDriver, type RawRule } from '../firewall-driver';
import { runCommand, assertSuccess } from './run-command';

@Injectable()
export class FirewalldDriver implements FirewallDriver {
  readonly backend: FirewallBackend = 'firewalld';

  async getStatus(): Promise<{ enabled: boolean }> {
    const result = await runCommand('firewall-cmd', ['--state']);
    // --state exits 0 when running, 252 when not running
    return { enabled: result.exitCode === 0 && /running/i.test(result.stdout) };
  }

  async enable(): Promise<void> {
    const result = await runCommand('systemctl', ['start', 'firewalld']);
    assertSuccess(result, 'systemctl start firewalld');
  }

  async disable(): Promise<void> {
    const result = await runCommand('systemctl', ['stop', 'firewalld']);
    assertSuccess(result, 'systemctl stop firewalld');
  }

  async listRules(): Promise<RawRule[]> {
    const result = await runCommand('firewall-cmd', ['--list-all', '--permanent']);
    assertSuccess(result, 'firewall-cmd --list-all --permanent');
    return parseFirewalldOutput(result.stdout);
  }

  async addRule(rule: RawRule): Promise<void> {
    const expr = buildRichRule(rule);
    const result = await runCommand('firewall-cmd', [
      '--permanent',
      `--add-rich-rule=${expr}`,
    ]);
    assertSuccess(result, `firewall-cmd --add-rich-rule=${expr}`);
    await this.reload();
  }

  async removeRule(rule: RawRule): Promise<void> {
    const expr = buildRichRule(rule);
    const result = await runCommand('firewall-cmd', [
      '--permanent',
      `--remove-rich-rule=${expr}`,
    ]);
    assertSuccess(result, `firewall-cmd --remove-rich-rule=${expr}`);
    await this.reload();
  }

  private async reload(): Promise<void> {
    const result = await runCommand('firewall-cmd', ['--reload']);
    assertSuccess(result, 'firewall-cmd --reload');
  }
}

/**
 * Parse `firewall-cmd --list-all --permanent`. Extracts:
 *  - `ports:` line → allow rules with no source restriction
 *  - `rich rules:` block → allow/deny rules with optional source
 *
 * Anything we can't represent in `RawRule` (services, ICMP blocks,
 * masquerade, forward-ports) is dropped — they show as zero rules
 * from the panel's POV. Same v0.5 limitation as port-ranges in ufw.
 */
export function parseFirewalldOutput(stdout: string): RawRule[] {
  const out: RawRule[] = [];

  // ports: section (single line)
  const portsMatch = /^\s*ports:\s*(.*)$/m.exec(stdout);
  if (portsMatch && portsMatch[1]?.trim()) {
    const tokens = portsMatch[1].trim().split(/\s+/);
    for (const token of tokens) {
      if (/-/.test(token)) continue; // port range, skip
      const m = /^(\d+)\/(tcp|udp)$/.exec(token);
      if (!m) continue;
      out.push({
        port: Number(m[1]),
        proto: m[2] as FirewallProto,
        source: null,
        action: 'allow',
      });
    }
  }

  // rich rules: scan every line, parse anything starting with `rule `.
  // (firewall-cmd emits them under a `rich rules:` header but the rule
  // syntax is unambiguous enough that we don't need to track section
  // membership — and the regex-driven block extraction had trouble with
  // the trailing whitespace on the header line.)
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('rule ')) continue;
    const parsed = parseRichRule(line);
    if (parsed) out.push(parsed);
  }

  return out;
}

function parseRichRule(line: string): RawRule | null {
  const portMatch = /port\s+port="(\d+)"\s+protocol="(tcp|udp)"/.exec(line);
  if (!portMatch) return null;
  const port = Number(portMatch[1]);
  const proto = portMatch[2] as FirewallProto;
  const sourceMatch = /source\s+address="([^"]+)"/.exec(line);
  const source = sourceMatch ? sourceMatch[1]! : null;
  const action: FirewallAction | null = /\baccept\b/.test(line)
    ? 'allow'
    : /\breject\b|\bdrop\b/.test(line)
      ? 'deny'
      : null;
  if (!action) return null;
  return { port, proto, source, action };
}

export function buildRichRule(rule: RawRule): string {
  const family = rule.source && /:/.test(rule.source) ? 'ipv6' : 'ipv4';
  const parts: string[] = [`rule family="${family}"`];
  if (rule.source) parts.push(`source address="${rule.source}"`);
  const protoForRule = rule.proto === 'any' ? 'tcp' : rule.proto;
  parts.push(`port port="${rule.port}" protocol="${protoForRule}"`);
  parts.push(rule.action === 'allow' ? 'accept' : 'reject');
  return parts.join(' ');
}
