import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UsePipes,
} from '@nestjs/common';
import {
  acmeIssueRequestSchema,
  type AcmeIssueRequest,
  type AcmeStatusResponse,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AcmeOrchestratorService } from './acme-orchestrator.service';

/**
 * Mounted under `/api/websites/:id/ssl`.
 *
 * Auth is enforced globally via `APP_GUARD: JwtAuthGuard` registered
 * in AuthModule — no per-route guard needed.
 */
@Controller('websites/:id/ssl')
export class AcmeController {
  constructor(private readonly orchestrator: AcmeOrchestratorService) {}

  @Post('issue')
  @UsePipes(new ZodValidationPipe(acmeIssueRequestSchema))
  async issue(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AcmeIssueRequest,
  ): Promise<AcmeStatusResponse> {
    await this.orchestrator.issueForSite(id, body.challenge, body.dnsProvider);
    return this.orchestrator.status(id);
  }

  @Post('renew')
  async renew(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AcmeStatusResponse> {
    await this.orchestrator.renew(id);
    return this.orchestrator.status(id);
  }

  @Get('status')
  status(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AcmeStatusResponse> {
    return this.orchestrator.status(id);
  }
}
