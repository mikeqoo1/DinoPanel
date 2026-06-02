import { Body, Controller, Get, Post, UsePipes } from '@nestjs/common';
import {
  setNtpBodySchema,
  setTimezoneBodySchema,
  type NtpStatus,
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
}
