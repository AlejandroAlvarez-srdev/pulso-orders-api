import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type AppConfig } from '../config/app-config';
import { InMemoryMerchantsRepository } from '../merchants/in-memory-merchants.repository';
import { hashApiKey } from '../merchants/merchant';
import { AuthService } from './auth.service';
import { type TokenClaims } from './token-claims';

const config = {
  jwt: { secret: 's'.repeat(32), issuer: 'test', ttlSeconds: 60 },
} as AppConfig;

describe('AuthService', () => {
  const jwt = new JwtService({ secret: config.jwt.secret, signOptions: { expiresIn: 60 } });
  const merchants = new InMemoryMerchantsRepository([
    { id: 'merchant-1', name: 'Farmacia Roma', apiKeyHash: hashApiKey('pk_live_roma_123'), createdAt: new Date() },
  ]);
  const service = new AuthService(jwt, merchants, config);

  it('issues a token whose subject is the merchant', async () => {
    const token = await service.issueToken('pk_live_roma_123');
    const claims = await jwt.verifyAsync<TokenClaims>(token.accessToken);

    expect(token).toMatchObject({ tokenType: 'Bearer', expiresIn: 60, scope: 'orders:read orders:write' });
    expect(claims).toMatchObject({ sub: 'merchant-1', scope: 'orders:read orders:write' });
  });

  it('narrows the token to the requested scopes', async () => {
    const token = await service.issueToken('pk_live_roma_123', ['orders:read', 'orders:read']);

    expect(token.scope).toBe('orders:read');
  });

  it('rejects unknown API keys', async () => {
    await expect(service.issueToken('pk_wrong_key')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
