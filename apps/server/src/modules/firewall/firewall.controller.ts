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
  fail2banBanBodySchema,
  fail2banUnbanBodySchema,
  fail2banSetEnabledBodySchema,
  type StageFirewallRuleBody,
  type FirewallStatus,
  type FirewallRule,
  type StagedRuleResponse,
  type Fail2banEntry,
  type Fail2banJail,
  type Fail2banBanBody,
  type Fail2banUnbanBody,
  type Fail2banSetEnabledBody,
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

  @Get('fail2ban/jails')
  fail2banJails(): Promise<Fail2banJail[]> {
    return this.firewall.fail2banJails();
  }

  @Post('fail2ban/ban')
  @UsePipes(new ZodValidationPipe(fail2banBanBodySchema))
  fail2banBan(@Body() body: Fail2banBanBody): Promise<{ ok: true }> {
    return this.firewall.fail2banBan(body.jail, body.ip);
  }

  @Post('fail2ban/unban')
  @UsePipes(new ZodValidationPipe(fail2banUnbanBodySchema))
  fail2banUnban(@Body() body: Fail2banUnbanBody): Promise<{ ok: true }> {
    return this.firewall.fail2banUnban(body.ip, body.jail);
  }

  @Post('fail2ban/jails/:name/enabled')
  @UsePipes(new ZodValidationPipe(fail2banSetEnabledBodySchema))
  setJailEnabled(
    @Param('name') name: string,
    @Body() body: Fail2banSetEnabledBody,
  ): Promise<{ ok: true }> {
    return this.firewall.fail2banSetJailEnabled(name, body.enabled);
  }
}
