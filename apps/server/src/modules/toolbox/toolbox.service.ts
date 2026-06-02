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
  ServiceUnit,
  SystemdAction,
  ToolboxStatus,
} from '@dinopanel/shared';
import { serviceActionAllowed, serviceUnitNameSchema } from '@dinopanel/shared';
import type { AppConfig } from '../../config/configuration';
import { CommandError, commandErrorToHttp, probeCommand } from '../../common/shell/run-command';
import type { NtpDriver } from './drivers/ntp-driver';
import type { DiskDriver } from './drivers/disk-driver';
import type { CleanerDriver } from './drivers/cleaner-driver';
import type { ServicesDriver } from './drivers/services-driver';

export const NTP_DRIVER = Symbol('NTP_DRIVER');
export const DISK_DRIVER = Symbol('DISK_DRIVER');
export const CLEANER_DRIVER = Symbol('CLEANER_DRIVER');
export const SERVICES_DRIVER = Symbol('SERVICES_DRIVER');

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
    @Inject(SERVICES_DRIVER) private readonly services: ServicesDriver,
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
    const servicesAvailable = this.services.available;
    // Listing services needs no sudo, but the lifecycle actions do — so the
    // feature is "degraded" (read-only-usable) when sudo is required but absent.
    const servicesDegraded = servicesAvailable && this.requireSudo && !this.sudoProbeOk;
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
        {
          name: 'services',
          available: servicesAvailable,
          degraded: servicesDegraded,
          reason: !servicesAvailable
            ? 'SERVICES_NOT_CONFIGURED'
            : servicesDegraded
              ? 'SUDO_UNAVAILABLE'
              : null,
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

  /** GET /toolbox/services — all systemd .service units (read-only). */
  listServices(): Promise<ServiceUnit[]> {
    return this.hostOp(() => this.services.list());
  }

  /** POST /toolbox/services/action — start|stop|restart|enable|disable a unit. */
  async serviceAction(unit: string, action: SystemdAction): Promise<{ ok: true }> {
    // Defense-in-depth shape check (the controller's ZodValidationPipe also
    // enforces this) — never shell out with a name that could be a flag.
    if (!serviceUnitNameSchema.safeParse(unit).success) {
      throw new BadRequestException({
        code: 'SERVICE_INVALID_UNIT',
        message: `Invalid systemd unit name: ${unit}`,
      });
    }
    // Tiered protected-units guard (the shared single source the web mirrors):
    // .service-only, self refuses all, critical units refuse stop/disable.
    const verdict = serviceActionAllowed(unit, action);
    if (!verdict.allowed) {
      throw new BadRequestException({ code: 'SERVICE_PROTECTED', message: verdict.reason });
    }
    // A string denylist can't see systemd aliases (e.g.
    // dbus-org.freedesktop.login1.service IS systemd-logind.service), so
    // resolve the canonical Id and re-judge on it before mutating.
    const canonical = await this.services.resolveCanonicalUnit(unit);
    const canonicalVerdict = serviceActionAllowed(canonical, action);
    if (!canonicalVerdict.allowed) {
      throw new BadRequestException({ code: 'SERVICE_PROTECTED', message: canonicalVerdict.reason });
    }
    await this.hostOp(() => this.services.action(unit, action));
    return { ok: true };
  }
}
