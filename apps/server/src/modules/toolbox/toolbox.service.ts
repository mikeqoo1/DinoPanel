import {
  BadRequestException,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import type { NtpStatus, ToolboxStatus } from '@dinopanel/shared';
import type { AppConfig } from '../../config/configuration';
import { CommandError, commandErrorToHttp, probeCommand } from '../../common/shell/run-command';
import type { NtpDriver } from './drivers/ntp-driver';

export const NTP_DRIVER = Symbol('NTP_DRIVER');

@Injectable()
export class ToolboxService implements OnApplicationBootstrap {
  private readonly requireSudo: boolean;
  private sudoProbeOk = false;

  constructor(
    @Inject(NTP_DRIVER) private readonly ntp: NtpDriver,
    @Inject(ConfigService) config: ConfigService<{ app: AppConfig }>,
    private readonly logger: Logger,
  ) {
    const app = config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    this.requireSudo = app.env.TOOLBOX_REQUIRE_SUDO;
  }

  async onApplicationBootstrap(): Promise<void> {
    // Never-throws boot probe — the panel boots even when sudo isn't set up.
    this.sudoProbeOk = await probeCommand('sudo', ['-n', 'true']);
    if (!this.sudoProbeOk && this.requireSudo) {
      this.logger.warn(
        { sudoProbeOk: false },
        'toolbox.sudo_probe_failed — add the NOPASSWD sudoers entry (see docs/toolbox.md)',
      );
    }
    this.logger.debug(
      { ntpAvailable: this.ntp.available, sudoOk: this.sudoProbeOk },
      'toolbox.bootstrap',
    );
  }

  /**
   * Re-wrap host-command failures as coded TOOLBOX_* HttpExceptions so
   * ApiExceptionFilter surfaces a real `code` instead of a generic 500
   * (the shared firewall driverOp pattern). HttpExceptions (e.g. the
   * Unavailable driver's 503) pass straight through.
   */
  private async ntpOp<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CommandError) throw commandErrorToHttp(err, 'TOOLBOX');
      throw err;
    }
  }

  /** GET /toolbox/status — computed from driver availability + sudo posture. */
  status(): ToolboxStatus {
    const available = this.ntp.available;
    const degraded = available && this.requireSudo && !this.sudoProbeOk;
    const reason = !available ? 'NTP_NOT_CONFIGURED' : degraded ? 'SUDO_UNAVAILABLE' : null;
    return { features: [{ name: 'ntp', available, degraded, reason }] };
  }

  getNtpStatus(): Promise<NtpStatus> {
    return this.ntpOp(() => this.ntp.getStatus());
  }

  async setNtp(enabled: boolean): Promise<NtpStatus> {
    await this.ntpOp(() => this.ntp.setNtp(enabled));
    return this.getNtpStatus();
  }

  async setTimezone(tz: string): Promise<NtpStatus> {
    // Allowlist check against the host's own zone DB before shelling out —
    // a clean 400 instead of a confusing COMMAND_FAILED 500. (On an
    // unavailable host listTimezones 503s, which is the correct signal.)
    const zones = await this.ntpOp(() => this.ntp.listTimezones());
    if (!zones.includes(tz)) {
      throw new BadRequestException({
        code: 'TOOLBOX_INVALID_TIMEZONE',
        message: `Unknown timezone: ${tz}`,
      });
    }
    await this.ntpOp(() => this.ntp.setTimezone(tz));
    this.logger.debug({ tz }, 'toolbox.ntp.timezone_set');
    return this.getNtpStatus();
  }
}
