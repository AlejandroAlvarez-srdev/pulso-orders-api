import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { type Principal } from '../common/http/request-context';
import { MERCHANTS_REPOSITORY, type MerchantsRepository } from './merchants.repository';

export class MerchantResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Tienda Demo CDMX' }) name!: string;
  @ApiProperty() createdAt!: Date;
}

@ApiTags('merchants')
@ApiBearerAuth()
@Controller('merchants')
export class MerchantsController {
  constructor(@Inject(MERCHANTS_REPOSITORY) private readonly merchants: MerchantsRepository) {}

  @Get('me')
  @ApiOkResponse({ type: MerchantResponseDto })
  async me(@CurrentPrincipal() principal: Principal): Promise<MerchantResponseDto> {
    const merchant = await this.merchants.findById(principal.merchantId);
    if (!merchant) throw new NotFoundException('Merchant no longer exists');
    return { id: merchant.id, name: merchant.name, createdAt: merchant.createdAt };
  }
}
