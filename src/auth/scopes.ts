import { SetMetadata } from '@nestjs/common';

export const SCOPES = ['orders:read', 'orders:write'] as const;
export type Scope = (typeof SCOPES)[number];

export const REQUIRED_SCOPES = 'pulso:requiredScopes';

/** Requires the bearer token to carry every listed scope (403 otherwise). */
export const RequireScopes = (...scopes: Scope[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_SCOPES, scopes);
