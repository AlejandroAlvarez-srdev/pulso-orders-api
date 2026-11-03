import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPreconditionFailedResponse,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequireScopes } from '../auth/scopes';
import { PreconditionFailedError, PreconditionRequiredError } from '../common/domain-errors';
import { RequestValidationError } from '../common/http/problem-details';
import { type Principal } from '../common/http/request-context';
import {
  CreateOrderDto,
  ListOrdersQueryDto,
  OrderResponseDto,
  OrdersPageDto,
  TransitionOrderDto,
  UpdateOrderDto,
  toOrderResponse,
} from './dto/order.dto';
import { orderEtag, parseIfMatch } from './etag';
import { type Order } from './domain/order';
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

/** Version required by If-Match: undefined when absent or `*`, 412 when it cannot match. */
function versionFromIfMatch(header: string | undefined): number | undefined {
  const parsed = parseIfMatch(header);
  if (!parsed || parsed.kind === 'any') return undefined;
  if (parsed.kind === 'unparseable') throw new PreconditionFailedError('If-Match does not match any order ETag');
  return parsed.version;
}

function withEtag(res: Response, order: Order): OrderResponseDto {
  res.setHeader('ETag', orderEtag(order.version));
  return toOrderResponse(order);
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
      // The stored creation snapshot is always version 0.
      .setHeader('ETag', orderEtag(0))
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
  @ApiOkResponse({ type: OrderResponseDto, description: 'Carries an ETag for conditional requests' })
  @ApiResponse({ status: 304, description: 'If-None-Match matched the current ETag' })
  @ApiNotFoundResponse({ description: 'No such order for this merchant' })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponseDto | undefined> {
    const order = await this.orders.get(principal.merchantId, id);
    const cached = parseIfMatch(ifNoneMatch);
    if (cached?.kind === 'any' || (cached?.kind === 'version' && cached.version === order.version)) {
      res.status(HttpStatus.NOT_MODIFIED).setHeader('ETag', orderEtag(order.version));
      return undefined;
    }
    return withEtag(res, order);
  }

  @Patch(':id')
  @RequireScopes('orders:write')
  @ApiHeader({ name: 'If-Match', required: true, description: 'ETag from a previous GET, e.g. "v0"' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiPreconditionFailedResponse({ description: 'The order changed since that ETag' })
  @ApiResponse({ status: 428, description: 'If-Match is missing' })
  @ApiConflictResponse({ description: 'The order is past CREATED and can no longer be edited' })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponseDto> {
    if (ifMatch === undefined) throw new PreconditionRequiredError('PATCH /orders/:id requires an If-Match header');
    if (body.dropoff === undefined && body.items === undefined && body.amountCents === undefined) {
      throw new RequestValidationError([{ field: 'body', messages: ['Provide at least one of dropoff, items, amountCents'] }]);
    }
    const current = await this.orders.get(principal.merchantId, id);
    const expected = versionFromIfMatch(ifMatch) ?? current.version;
    return withEtag(res, await this.orders.updateDetails(principal.merchantId, id, body, expected));
  }

  @Post(':id/transitions')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('orders:write')
  @ApiHeader({ name: 'If-Match', required: false, description: 'Optional ETag; a mismatch is a 412' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Transition not allowed from the current status, or concurrent update' })
  @ApiPreconditionFailedResponse({ description: 'If-Match given and the order changed since' })
  async transition(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: TransitionOrderDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponseDto> {
    const expected = versionFromIfMatch(ifMatch);
    return withEtag(
      res,
      await this.orders.transition(principal.merchantId, id, body.status, body.reason, expected),
    );
  }
}
