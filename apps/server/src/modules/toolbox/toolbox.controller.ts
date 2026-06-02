import { Body, Controller, Get, Post, Query, UsePipes } from '@nestjs/common';
import {
  setNtpBodySchema,
  setTimezoneBodySchema,
  cleanBodySchema,
  serviceActionBodySchema,
  type CleanBody,
  type CleanResult,
  type CleanersList,
  type DiskUsage,
  type NtpStatus,
  type ServiceActionBody,
  type ServiceUnit,
  type SetNtpBody,
  type SetTimezoneBody,
  type ToolboxStatus,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ToolboxService } from './toolbox.service';

@Controller('toolbox')
export class ToolboxController {
  constructor(private readonly toolbox: ToolboxService) {}

  @Get('status')
  status(): ToolboxStatus {
    return this.toolbox.status();
  }

  @Get('ntp')
  ntp(): Promise<NtpStatus> {
    return this.toolbox.getNtpStatus();
  }

  @Post('ntp/set')
  @UsePipes(new ZodValidationPipe(setNtpBodySchema))
  setNtp(@Body() body: SetNtpBody): Promise<NtpStatus> {
    return this.toolbox.setNtp(body.enabled);
  }

  @Post('ntp/timezone')
  @UsePipes(new ZodValidationPipe(setTimezoneBodySchema))
  setTimezone(@Body() body: SetTimezoneBody): Promise<NtpStatus> {
    return this.toolbox.setTimezone(body.timezone);
  }

  @Get('ntp/timezones')
  timezones(): Promise<string[]> {
    return this.toolbox.listTimezones();
  }

  @Get('disk')
  getDisk(@Query('path') path?: string): Promise<DiskUsage> {
    // `path` is validated against the SAFE_DU_ROOTS allowlist in the service.
    return this.toolbox.getDisk(path);
  }

  @Get('cleaners')
  cleaners(): CleanersList {
    return this.toolbox.listCleaners();
  }

  @Post('clean')
  @UsePipes(new ZodValidationPipe(cleanBodySchema))
  clean(@Body() body: CleanBody): Promise<CleanResult> {
    return this.toolbox.runCleaner(body.category);
  }

  @Get('services')
  services(): Promise<ServiceUnit[]> {
    return this.toolbox.listServices();
  }

  @Post('services/action')
  @UsePipes(new ZodValidationPipe(serviceActionBodySchema))
  serviceAction(@Body() body: ServiceActionBody): Promise<{ ok: true }> {
    return this.toolbox.serviceAction(body.unit, body.action);
  }
}
