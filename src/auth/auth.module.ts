import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwt.secret,
        signOptions: { algorithm: 'HS256', issuer: config.jwt.issuer, expiresIn: config.jwt.ttlSeconds },
        verifyOptions: { algorithms: ['HS256'], issuer: config.jwt.issuer },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Global guards run in registration order: authenticate first, so the
    // rate limiter can key on the merchant instead of the IP.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AuthModule {}
