import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequireScopes } from '../auth/scopes';
import { RequestValidationError } from '../common/http/problem-details';
import { type Principal } from '../common/http/request-context';
import {
  CreateOrderDto,
  ListOrdersQueryDto,
  OrderResponseDto,
  OrdersPageDto,
  TransitionOrderDto,
  toOrderResponse,
} from './dto/order.dto';
import { OrdersService } from './orders.service';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'idempotency-replayed';

// Visible ASCII only, bounded so it fits the storage column.
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;

function requireIdempotencyKey(value: string | undefined): string {
  if (value && IDEMPOTENCY_KEY.test(value)) return value;
  throw new RequestValidationError([
    {
      field: 'Idempotency-Key',
      messages: [
        value ? 'Idempotency-Key must be 1-255 visible ASCII characters' : 'Idempotency-Key header is required',
      ],
    },
  ]);
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @RequireScopes('orders:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique per logical request, e.g. a UUID' })
  @ApiCreatedResponse({ type: OrderResponseDto, description: 'Created, or replayed from a previous identical request' })
  @ApiConflictResponse({ description: 'The first request with this key is still in flight' })
  @ApiUnprocessableEntityResponse({ description: 'The key was already used with a different body' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponseDto> {
    const key = requireIdempotencyKey(idempotencyKey);
    const result = await this.orders.create(principal.merchantId, body, key);
    res
      .status(result.statusCode)
      .location(`/orders/${result.body.id}`)
      .setHeader(IDEMPOTENCY_REPLAYED_HEADER, String(result.replayed));
    return result.body;
  }

  @Get()
  @RequireScopes('orders:read')
  @ApiOkResponse({ type: OrdersPageDto })
  async list(@CurrentPrincipal() principal: Principal, @Query() query: ListOrdersQueryDto): Promise<OrdersPageDto> {
    const page = await this.orders.list(principal.merchantId, query);
    return { data: page.items.map(toOrderResponse), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @RequireScopes('orders:read')
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'No such order for this merchant' })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrderResponseDto> {
    return toOrderResponse(await this.orders.get(principal.merchantId, id));
  }

  @Post(':id/transitions')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('orders:write')
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Transition not allowed from the current status, or concurrent update' })
  async transition(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: TransitionOrderDto,
  ): Promise<OrderResponseDto> {
    return toOrderResponse(await this.orders.transition(principal.merchantId, id, body.status, body.reason));
  }
}
