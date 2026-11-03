import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { EVENT_PUBLISHER, HttpEventPublisher, LoggingEventPublisher } from './relay/event-publisher';
import { OutboxRelay } from './relay/outbox-relay';

@Module({
  providers: [
    OutboxRelay,
    {
      provide: EVENT_PUBLISHER,
      inject: [APP_CONFIG],
      useFactory: ({ outboxRelay }: AppConfig) =>
        outboxRelay.webhookUrl ? new HttpEventPublisher(outboxRelay.webhookUrl) : new LoggingEventPublisher(),
    },
  ],
  exports: [OutboxRelay],
})
export class OutboxModule {}
