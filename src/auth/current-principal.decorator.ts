import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Request } from 'express';
import { type Principal } from '../common/http/request-context';

/** Injects the principal set by JwtAuthGuard. Only valid on non-public routes. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const principal = ctx.switchToHttp().getRequest<Request>().principal;
  if (!principal) throw new Error('CurrentPrincipal used on a route without authentication');
  return principal;
});
