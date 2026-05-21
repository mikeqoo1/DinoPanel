import { Body, Controller, Get, Put, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MonitoringService } from './monitoring.service';

const configBodySchema = z.object({
  url: z.string().min(1).nullable(),
});
type ConfigBody = z.infer<typeof configBodySchema>;

const credentialsBodySchema = z.object({
  // null = no change; '' = clear; any string = replace
  apiToken: z.string().nullable(),
  // null = clear setting (fall back to env default); true / false = explicit
  tlsSkipVerify: z.boolean().nullable(),
});
type CredentialsBody = z.infer<typeof credentialsBodySchema>;

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('pmm/config')
  @UsePipes()
  async getConfig() {
    return this.monitoring.getConfig();
  }

  @Put('pmm/config')
  @UsePipes(new ZodValidationPipe(configBodySchema))
  async setConfig(@Body() body: ConfigBody) {
    // MonitoringService fires its credentials-change listeners
    // internally; DbMetricsService + ExternalPmmService subscribe at
    // module init (avoids a MonitoringModule → DatabasesModule import
    // cycle that direct injection would require).
    return this.monitoring.setConfig(body.url);
  }

  @Get('pmm/credentials')
  async getCredentials() {
    return this.monitoring.getCredentialsView();
  }

  @Put('pmm/credentials')
  @UsePipes(new ZodValidationPipe(credentialsBodySchema))
  async setCredentials(@Body() body: CredentialsBody) {
    return this.monitoring.setCredentials(body);
  }

  @Get('pmm/status')
  async status() {
    return this.monitoring.getPmmStatus();
  }
}
