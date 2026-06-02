import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import type {
  CleanCategory,
  CleanResult,
  CleanersList,
  DiskUsage,
  NtpStatus,
  ToolboxStatus,
} from '@dinopanel/shared';
import type { AppConfig } from '../../config/configuration';
import { CommandError, commandErrorToHttp, probeCommand } from '../../common/shell/run-command';
import type { NtpDriver } from './drivers/ntp-driver';
import type { DiskDriver } from './drivers/disk-driver';
import type { CleanerDriver } from './drivers/cleaner-driver';

export const NTP_DRIVER = Symbol('NTP_DRIVER');
export const DISK_DRIVER = Symbol('DISK_DRIVER');
export const CLEANER_DRIVER = Symbol('CLEANER_DRIVER');

// Closed allowlist of roots the du breakdown may scan. The disk view is
// read-only, so an exact-match enum is the gate (NOT the files-module write
// guard). Extend deliberately.
const SAFE_DU_ROOTS: readonly string[] = ['/var', '/usr', '/home', '/opt', '/var/log', '/var/lib'];

@Injectable()
export class ToolboxService implements OnApplicationBootstrap {
  private readonly requireSudo: boolean;
  private readonly isDev: boolean;
  private sudoProbeOk = false;

  constructor(
    @Inject(NTP_DRIVER) private readonly ntp: NtpDriver,
    @Inject(DISK_DRIVER) private readonly disk: DiskDriver,
    @Inject(CLEANER_DRIVER) private readonly cleaner: CleanerDriver,
    @Inject(ConfigService) config: ConfigService<{ app: AppConfig }>,
    private readonly logger: Logger,
  ) {
    const app = config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    this.requireSudo = app.env.TOOLBOX_REQUIRE_SUDO;
    this.isDev = app.isDev ?? false;
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
  private async hostOp<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CommandError) throw this.rewrapCommandError(err);
      throw err;
    }
  }

  /**
   * Log the full host stderr server-side, then re-wrap to a coded
   * HttpException whose client `details.stderr` is gated on `isDev` (Phase 4
   * hardening — raw host stderr never reaches the client in production).
   */
  private rewrapCommandError(err: CommandError): HttpException {
    if (err.stderr) {
      this.logger.warn({ kind: err.kind, stderr: err.stderr }, 'toolbox.command_failed');
    }
    return commandErrorToHttp(err, 'TOOLBOX', { exposeStderr: this.isDev });
  }

  /** GET /toolbox/status — computed from driver availability + sudo posture. */
  status(): ToolboxStatus {
    const ntpAvailable = this.ntp.available;
    const ntpDegraded = ntpAvailable && this.requireSudo && !this.sudoProbeOk;
    const diskAvailable = this.disk.available;
    return {
      features: [
        {
          name: 'ntp',
          available: ntpAvailable,
          degraded: ntpDegraded,
          reason: !ntpAvailable ? 'NTP_NOT_CONFIGURED' : ntpDegraded ? 'SUDO_UNAVAILABLE' : null,
        },
        {
          name: 'disk',
          available: diskAvailable,
          degraded: false, // read-only df/du — no sudo dependency
          reason: diskAvailable ? null : 'DISK_NOT_CONFIGURED',
        },
      ],
    };
  }

  getNtpStatus(): Promise<NtpStatus> {
    return this.hostOp(() => this.ntp.getStatus());
  }

  async setNtp(enabled: boolean): Promise<NtpStatus> {
    await this.hostOp(() => this.ntp.setNtp(enabled));
    return this.getNtpStatus();
  }

  async setTimezone(tz: string): Promise<NtpStatus> {
    // Allowlist check against the host's own zone DB before shelling out —
    // a clean 400 instead of a confusing COMMAND_FAILED 500. (On an
    // unavailable host listTimezones 503s, which is the correct signal.)
    const zones = await this.hostOp(() => this.ntp.listTimezones());
    if (!zones.includes(tz)) {
      throw new BadRequestException({
        code: 'TOOLBOX_INVALID_TIMEZONE',
        message: `Unknown timezone: ${tz}`,
      });
    }
    await this.hostOp(() => this.ntp.setTimezone(tz));
    this.logger.debug({ tz }, 'toolbox.ntp.timezone_set');
    return this.getNtpStatus();
  }

  /** GET /toolbox/ntp/timezones — the host zone list (for the picker). */
  listTimezones(): Promise<string[]> {
    return this.hostOp(() => this.ntp.listTimezones());
  }

  /** GET /toolbox/disk — filesystem usage + optional per-directory breakdown. */
  async getDisk(path?: string): Promise<DiskUsage> {
    const filesystems = await this.hostOp(() => this.disk.listFilesystems());
    let breakdown: DiskUsage['breakdown'] = null;
    if (path !== undefined) {
      if (!SAFE_DU_ROOTS.includes(path)) {
        throw new BadRequestException({
          code: 'TOOLBOX_DISK_PATH_NOT_ALLOWED',
          message: `Path not in the disk-breakdown allowlist: ${path}`,
        });
      }
      breakdown = await this.hostOp(() => this.disk.breakdown(path));
    }
    return { filesystems, breakdown, safeRoots: [...SAFE_DU_ROOTS] };
  }

  /** GET /toolbox/cleaners — per-category availability. */
  listCleaners(): CleanersList {
    return { cleaners: this.cleaner.list() };
  }

  /** POST /toolbox/clean — run one curated cleaner. */
  runCleaner(category: CleanCategory): Promise<CleanResult> {
    // docker_prune surfaces coded HttpExceptions via mapDockerError; the shell
    // cleaners throw CommandError, which hostOp re-wraps to TOOLBOX_*.
    return this.hostOp(() => this.cleaner.run(category));
  }
}
