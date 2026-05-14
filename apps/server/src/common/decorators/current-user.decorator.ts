import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthUserContext {
  id: number;
  username: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserContext => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthUserContext }>();
    return req.user;
  },
);
