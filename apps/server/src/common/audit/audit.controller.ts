import { Body, Controller, Get, Put, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { AuditService } from './audit.service';

const retentionBodySchema = z.object({
  days: z.number().int().min(1).max(365),
});
type RetentionBody = z.infer<typeof retentionBodySchema>;

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('retention')
  async getRetention(): Promise<{ days: number }> {
    return { days: await this.audit.getRetentionDays() };
  }

  @Put('retention')
  @UsePipes(new ZodValidationPipe(retentionBodySchema))
  async setRetention(@Body() body: RetentionBody): Promise<{ days: number }> {
    return { days: await this.audit.setRetentionDays(body.days) };
  }
}
