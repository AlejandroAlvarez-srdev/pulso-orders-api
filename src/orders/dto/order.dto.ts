import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { type Currency, type Order, OrderStatus } from '../domain/order';

export class LocationDto {
  @ApiProperty({ example: 19.4326 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: -99.1332 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiProperty({ example: 'Av. Paseo de la Reforma 222, Juárez, CDMX' })
  @IsString()
  @Length(3, 300)
  address!: string;
}

export class OrderItemDto {
  @ApiProperty({ example: 'FARM-PARA-500' })
  @IsString()
  @Length(1, 64)
  sku!: string;

  @ApiProperty({ example: 'Paracetamol 500 mg' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 999 })
  @IsInt()
  @Min(1)
  @Max(999)
  qty!: number;
}

export const SUPPORTED_CURRENCIES = ['MXN'] as const;

export class CreateOrderDto {
  @ApiProperty({ type: LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  pickup!: LocationDto;

  @ApiProperty({ type: LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  dropoff!: LocationDto;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ApiProperty({ example: 18_950, description: 'Total charged to the merchant, in cents' })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents!: number;

  @ApiProperty({ enum: SUPPORTED_CURRENCIES, example: 'MXN' })
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: Currency;
}

export class UpdateOrderDto {
  @ApiPropertyOptional({ type: LocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  dropoff?: LocationDto;

  @ApiPropertyOptional({ type: [OrderItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];

  @ApiPropertyOptional({ example: 21_500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents?: number;
}

export class TransitionOrderDto {
  @ApiProperty({ enum: OrderStatus, example: OrderStatus.CANCELLED, description: 'Target status' })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({ example: 'Customer no longer needs the delivery', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page (`nextCursor`)' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) merchantId!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ type: LocationDto }) pickup!: LocationDto;
  @ApiProperty({ type: LocationDto }) dropoff!: LocationDto;
  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiProperty() amountCents!: number;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) currency!: Currency;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class OrdersPageDto {
  @ApiProperty({ type: [OrderResponseDto] }) data!: OrderResponseDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Pass as `cursor` to fetch the next page' })
  nextCursor!: string | null;
}

/** Public representation; the optimistic-locking version stays internal. */
export function toOrderResponse(order: Order): OrderResponseDto {
  return {
    id: order.id,
    merchantId: order.merchantId,
    status: order.status,
    pickup: { ...order.pickup },
    dropoff: { ...order.dropoff },
    items: order.items.map((item) => ({ ...item })),
    amountCents: order.amountCents,
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
