import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { SCOPES, type Scope } from '../scopes';

export class TokenRequestDto {
  @ApiProperty({ example: 'pk_demo_pulso_merchant', description: 'Merchant API key' })
  @IsString()
  @Length(8, 200)
  apiKey!: string;

  @ApiPropertyOptional({ enum: SCOPES, isArray: true, description: 'Defaults to all scopes' })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(SCOPES, { each: true })
  scopes?: Scope[];
}

export class TokenResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: 'Bearer';
  @ApiProperty({ example: 3600 }) expiresIn!: number;
  @ApiProperty({ example: 'orders:read orders:write' }) scope!: string;
}
