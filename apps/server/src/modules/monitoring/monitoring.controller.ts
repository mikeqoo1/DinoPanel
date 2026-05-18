import { Body, Controller, Get, Put, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MonitoringService } from './monitoring.service';

const configBodySchema = z.object({
  url: z.string().min(1).nullable(),
});
type ConfigBody = z.infer<typeof configBodySchema>;

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('pmm/config')
  async getConfig() {
    return this.monitoring.getConfig();
  }

  @Put('pmm/config')
  @UsePipes(new ZodValidationPipe(configBodySchema))
  async setConfig(@Body() body: ConfigBody) {
    return this.monitoring.setConfig(body.url);
  }

  @Get('pmm/status')
  async status() {
    return this.monitoring.getPmmStatus();
  }
}
