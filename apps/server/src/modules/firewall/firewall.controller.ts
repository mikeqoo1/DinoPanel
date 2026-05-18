import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UsePipes,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  stageFirewallRuleBodySchema,
  type StageFirewallRuleBody,
  type FirewallStatus,
  type FirewallRule,
  type StagedRuleResponse,
  type Fail2banEntry,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { FirewallService } from './firewall.service';

interface AuthedRequest extends FastifyRequest {
  user?: { id: number; username: string };
}

@Controller('firewall')
export class FirewallController {
  constructor(private readonly firewall: FirewallService) {}

  @Get('status')
  status(): Promise<FirewallStatus> {
    return this.firewall.getStatus();
  }

  @Post('enable')
  async enable(): Promise<{ ok: true }> {
    await this.firewall.enable();
    return { ok: true };
  }

  @Post('disable')
  async disable(): Promise<{ ok: true }> {
    await this.firewall.disable();
    return { ok: true };
  }

  @Get('rules')
  rules(): Promise<FirewallRule[]> {
    return this.firewall.listRules();
  }

  @Post('rules/stage')
  @UsePipes(new ZodValidationPipe(stageFirewallRuleBodySchema))
  stage(
    @Body() body: StageFirewallRuleBody,
    @Req() req: AuthedRequest,
  ): Promise<StagedRuleResponse> {
    return this.firewall.stage(body, req.user?.id ?? null);
  }

  @Post('rules/:id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    return this.firewall.confirm(id);
  }

  @Post('rules/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    return this.firewall.cancelStage(id);
  }

  @Delete('rules/:id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    return this.firewall.removeRule(id);
  }

  @Get('fail2ban/banned')
  fail2banBanned(): Promise<Fail2banEntry[]> {
    return this.firewall.fail2banBanned();
  }

  @Post('fail2ban/unban')
  fail2banUnban(@Body() body: { ip: string; jail: string }): Promise<{ ok: true }> {
    return this.firewall.fail2banUnban(body.ip, body.jail);
  }
}
