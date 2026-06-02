import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { probeCommand } from '../../common/shell/run-command';
import { ToolboxController } from './toolbox.controller';
import { ToolboxService, NTP_DRIVER } from './toolbox.service';
import { TimedatectlNtpDriver, UnavailableNtpDriver, type NtpDriver } from './drivers/ntp-driver';

function which(cmd: string): Promise<boolean> {
  return probeCommand('which', [cmd], { timeoutMs: 5_000 });
}

/**
 * Selects the NTP driver at boot: the real timedatectl-backed driver when
 * `timedatectl` is on PATH, otherwise an Unavailable fallback that 503s
 * `NTP_NOT_CONFIGURED`. Mirrors the firewall module's which-probe factory.
 * ConfigModule is global, so ConfigService resolves without importing it.
 */
const ntpDriverProvider: Provider = {
  provide: NTP_DRIVER,
  inject: [ConfigService],
  useFactory: async (config: ConfigService<{ app: AppConfig }>): Promise<NtpDriver> => {
    if (await which('timedatectl')) {
      const app = config.get<AppConfig>('app', { infer: true });
      if (!app) throw new Error('App config missing');
      return new TimedatectlNtpDriver(app.env.TOOLBOX_REQUIRE_SUDO);
    }
    return new UnavailableNtpDriver();
  },
};

@Module({
  controllers: [ToolboxController],
  providers: [ntpDriverProvider, ToolboxService],
  exports: [ToolboxService],
})
export class ToolboxModule {}
