import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Dockerode from 'dockerode';
import type { AppConfig } from '../../config/configuration';
import { probeCommand } from '../../common/shell/run-command';
import { ContainersModule } from '../containers/containers.module';
import { DOCKER } from '../containers/docker.token';
import { ToolboxController } from './toolbox.controller';
import {
  ToolboxService,
  NTP_DRIVER,
  DISK_DRIVER,
  CLEANER_DRIVER,
  SERVICES_DRIVER,
} from './toolbox.service';
import { TimedatectlNtpDriver, UnavailableNtpDriver, type NtpDriver } from './drivers/ntp-driver';
import { DfDuDiskDriver, UnavailableDiskDriver, type DiskDriver } from './drivers/disk-driver';
import { CleanerDriver, type PackageManager } from './drivers/cleaner-driver';
import {
  SystemctlServicesDriver,
  UnavailableServicesDriver,
  type ServicesDriver,
} from './drivers/services-driver';

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

// Read-only df/du driver, or an Unavailable fallback when df is absent.
const diskDriverProvider: Provider = {
  provide: DISK_DRIVER,
  useFactory: async (): Promise<DiskDriver> =>
    (await which('df')) ? new DfDuDiskDriver() : new UnavailableDiskDriver(),
};

// Curated cleaners. Reuses the ContainersModule dockerode handle for prune;
// detects the host package manager (dnf|apt) + journalctl at boot.
const cleanerDriverProvider: Provider = {
  provide: CLEANER_DRIVER,
  inject: [DOCKER, ConfigService],
  useFactory: async (
    docker: Dockerode,
    config: ConfigService<{ app: AppConfig }>,
  ): Promise<CleanerDriver> => {
    const app = config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    const pkgManager: PackageManager = (await which('dnf'))
      ? 'dnf'
      : (await which('apt-get'))
        ? 'apt'
        : null;
    const journaldAvailable = await which('journalctl');
    return new CleanerDriver(docker, pkgManager, journaldAvailable, app.env.TOOLBOX_REQUIRE_SUDO);
  },
};

// systemd .service management (v0.6.1), or an Unavailable fallback when
// systemctl is absent. Reads need no sudo; mutations run sudo -n.
const servicesDriverProvider: Provider = {
  provide: SERVICES_DRIVER,
  inject: [ConfigService],
  useFactory: async (config: ConfigService<{ app: AppConfig }>): Promise<ServicesDriver> => {
    if (await which('systemctl')) {
      const app = config.get<AppConfig>('app', { infer: true });
      if (!app) throw new Error('App config missing');
      return new SystemctlServicesDriver(app.env.TOOLBOX_REQUIRE_SUDO);
    }
    return new UnavailableServicesDriver();
  },
};

@Module({
  imports: [ContainersModule], // for the DOCKER dockerode handle (docker_prune)
  controllers: [ToolboxController],
  providers: [
    ntpDriverProvider,
    diskDriverProvider,
    cleanerDriverProvider,
    servicesDriverProvider,
    ToolboxService,
  ],
  exports: [ToolboxService],
})
export class ToolboxModule {}
