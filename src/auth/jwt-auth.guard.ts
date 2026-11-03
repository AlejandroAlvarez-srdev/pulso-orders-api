import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type Request } from 'express';
import { IS_PUBLIC } from '../common/http/public.decorator';
import '../common/http/request-context';
import { REQUIRED_SCOPES, type Scope } from './scopes';
import { type TokenClaims } from './token-claims';

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i;

/**
 * Global guard: every route needs a valid merchant bearer token unless marked
 * @Public(). The verified merchant id becomes `req.principal`, which is the
 * only source of tenant scope for downstream handlers.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const match = BEARER.exec(req.header('authorization') ?? '');
    if (!match) throw new UnauthorizedException('Missing bearer token');

    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(match[1]);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (typeof claims.sub !== 'string' || typeof claims.scope !== 'string') {
      throw new UnauthorizedException('Token is missing required claims');
    }

    const scopes = claims.scope.split(' ').filter(Boolean);
    req.principal = { merchantId: claims.sub, scopes };

    const required = this.reflector.getAllAndOverride<Scope[]>(REQUIRED_SCOPES, targets) ?? [];
    const missing = required.filter((s) => !scopes.includes(s));
    if (missing.length) throw new ForbiddenException(`Token lacks required scope: ${missing.join(', ')}`);

    return true;
  }
}
