import { Logger } from '@nestjs/common';
import { type WireEvent } from '../wire-format';

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

/** Delivers one event to the outside world. Throwing means "not delivered, retry later". */
export interface EventPublisher {
  publish(event: WireEvent): Promise<void>;
}

/** Default sink for local runs: one structured log line per event. */
export class LoggingEventPublisher implements EventPublisher {
  private readonly logger = new Logger('Events');

  async publish(event: WireEvent): Promise<void> {
    this.logger.log({ msg: 'event published', event });
  }
}

/**
 * POSTs each event to a webhook (for example pulso-saga's ingress). The event
 * id doubles as Idempotency-Key so the receiver can drop redeliveries.
 */
export class HttpEventPublisher implements EventPublisher {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 5000,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async publish(event: WireEvent): Promise<void> {
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': event.id, 'x-event-type': event.type },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status} for event ${event.id}`);
  }
}
