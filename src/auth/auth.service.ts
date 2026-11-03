import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { hashApiKey } from '../merchants/merchant';
import { MERCHANTS_REPOSITORY, type MerchantsRepository } from '../merchants/merchants.repository';
import { SCOPES, type Scope } from './scopes';
import { type TokenClaims } from './token-claims';

export interface IssuedToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(MERCHANTS_REPOSITORY) private readonly merchants: MerchantsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Exchanges a merchant API key for a short-lived bearer token scoped to that merchant. */
  async issueToken(apiKey: string, requested: readonly Scope[] = SCOPES): Promise<IssuedToken> {
    const merchant = await this.merchants.findByApiKeyHash(hashApiKey(apiKey));
    if (!merchant) throw new UnauthorizedException('Invalid API key');

    const scope = [...new Set(requested)].join(' ');
    const claims: TokenClaims = { sub: merchant.id, scope };
    const accessToken = await this.jwt.signAsync(claims);
    return { accessToken, tokenType: 'Bearer', expiresIn: this.config.jwt.ttlSeconds, scope };
  }
}
