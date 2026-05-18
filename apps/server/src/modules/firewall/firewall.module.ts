import { Module, type Provider, ServiceUnavailableException } from '@nestjs/common';
import { FirewallController } from './firewall.controller';
import { FirewallService, FIREWALL_DRIVER } from './firewall.service';
import { UfwDriver } from './drivers/ufw.driver';
import { FirewalldDriver } from './drivers/firewalld.driver';
import type { FirewallBackend } from '@dinopanel/shared';
import type { FirewallDriver, RawRule } from './firewall-driver';
import { runCommand } from './drivers/run-command';

async function which(cmd: string): Promise<boolean> {
  try {
    const result = await runCommand('which', [cmd], { timeoutMs: 5_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Fallback driver used when neither ufw nor firewall-cmd is on PATH.
 * Every operation returns 503 with `code: FIREWALL_NOT_CONFIGURED`.
 * Matches the dockerode "lazy fail" pattern used by ContainersModule —
 * the panel still boots on machines without a firewall installed; only
 * the firewall endpoints fail.
 */
class UnavailableFirewallDriver implements FirewallDriver {
  readonly backend: FirewallBackend = 'ufw'; // arbitrary, never observed
  private throw503(): never {
    throw new ServiceUnavailableException({
      code: 'FIREWALL_NOT_CONFIGURED',
      message: 'Neither ufw nor firewall-cmd is installed on this host',
    });
  }
  getStatus(): never {
    this.throw503();
  }
  enable(): never {
    this.throw503();
  }
  disable(): never {
    this.throw503();
  }
  listRules(): Promise<RawRule[]> {
    return Promise.resolve([]);
  }
  addRule(): never {
    this.throw503();
  }
  removeRule(): never {
    this.throw503();
  }
}

const firewallDriverProvider: Provider = {
  provide: FIREWALL_DRIVER,
  inject: [UfwDriver, FirewalldDriver],
  useFactory: async (ufw: UfwDriver, firewalld: FirewalldDriver): Promise<FirewallDriver> => {
    if (await which('ufw')) return ufw;
    if (await which('firewall-cmd')) return firewalld;
    return new UnavailableFirewallDriver();
  },
};

@Module({
  controllers: [FirewallController],
  providers: [UfwDriver, FirewalldDriver, firewallDriverProvider, FirewallService],
  exports: [FirewallService],
})
export class FirewallModule {}
