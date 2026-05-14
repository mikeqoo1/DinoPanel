import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UsePipes,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RefreshInput,
} from '@dinopanel/shared';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, type AuthUserContext } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginInput, @Req() req: FastifyRequest) {
    const { tokens, user } = await this.auth.login(body.username, body.password, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { id: user.id, username: user.username, createdAt: user.createdAt },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @SkipThrottle()
  @UsePipes(new ZodValidationPipe(refreshSchema))
  async refresh(@Body() body: RefreshInput, @Req() req: FastifyRequest) {
    const tokens = await this.auth.refresh(body.refreshToken, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    return tokens;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(refreshSchema))
  async logout(@Body() body: RefreshInput) {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUserContext) {
    const u = await this.users.findById(user.id);
    if (!u) return null;
    return { id: u.id, username: u.username, createdAt: u.createdAt };
  }

  @Post('change-password')
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(changePasswordSchema))
  async changePassword(
    @CurrentUser() user: AuthUserContext,
    @Body() body: ChangePasswordInput,
  ) {
    await this.users.changePassword(user.id, body.oldPassword, body.newPassword);
  }
}
