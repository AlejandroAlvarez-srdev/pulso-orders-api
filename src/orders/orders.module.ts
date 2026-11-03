import { Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../common/clock';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, { provide: CLOCK, useValue: systemClock }],
})
export class OrdersModule {}
