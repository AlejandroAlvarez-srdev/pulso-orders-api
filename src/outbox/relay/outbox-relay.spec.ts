import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { type Clock } from '../../common/clock';
import { type AppConfig } from '../../config/app-config';
import { type DomainEvent } from '../domain-event';
import { InMemoryOutboxService } from '../in-memory-outbox.service';
import { type WireEvent } from '../wire-format';
import { type EventPublisher } from './event-publisher';
import { OutboxRelay } from './outbox-relay';

class ManualClock implements Clock {
  constructor(public current = new Date('2026-06-01T10:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

class RecordingPublisher implements EventPublisher {
  readonly delivered: WireEvent[] = [];
  failFor = new Set<string>();

  async publish(event: WireEvent): Promise<void> {
    if (this.failFor.has(event.id)) throw new Error('broker unavailable');
    this.delivered.push(event);
  }
}

const config = {
  outboxRelay: { enabled: false, intervalMs: 1000, batchSize: 10, retryBaseMs: 1000, retryMaxMs: 8000 },
} as AppConfig;

function setup() {
  const clock = new ManualClock();
  const outbox = new InMemoryOutboxService();
  const publisher = new RecordingPublisher();
  const relay = new OutboxRelay(outbox, publisher, clock, config);
  const record = (aggregateId: string = randomUUID(), type = 'order.created'): DomainEvent => {
    const event = { id: randomUUID(), type, aggregateId, occurredAt: clock.now(), payload: { orderId: aggregateId } };
    outbox.appendSync(event);
    clock.advance(1);
    return event;
  };
  return { clock, outbox, publisher, relay, record };
}

describe('OutboxRelay', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('delivers pending events in order, in the wire format, exactly once when healthy', async () => {
    const { relay, publisher, outbox, record, clock } = setup();
    const a = record();
    const b = record();

    expect(await relay.runOnce()).toEqual({ published: 2, failed: 0 });
    expect(await relay.runOnce()).toEqual({ published: 0, failed: 0 });

    expect(publisher.delivered.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(publisher.delivered[0]).toEqual({
      id: a.id,
      type: 'order.created',
      specVersion: '1.0',
      source: 'pulso-orders-api',
      aggregateId: a.aggregateId,
      occurredAt: a.occurredAt.toISOString(),
      data: a.payload,
    });
    expect(outbox.state(a.id)).toMatchObject({ publishedAt: clock.now(), attempts: 1, lastError: null });
  });

  it('retries a failed delivery only after its backoff has elapsed', async () => {
    const { relay, publisher, outbox, record, clock } = setup();
    const event = record();
    publisher.failFor.add(event.id);

    expect(await relay.runOnce()).toEqual({ published: 0, failed: 1 });
    const state = outbox.state(event.id)!;
    expect(state).toMatchObject({ publishedAt: null, attempts: 1, lastError: 'broker unavailable' });
    const delay = state.nextAttemptAt.getTime() - clock.now().getTime();
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(1000);

    publisher.failFor.clear();
    expect(await relay.runOnce()).toEqual({ published: 0, failed: 0 });
    clock.advance(delay);
    expect(await relay.runOnce()).toEqual({ published: 1, failed: 0 });
    expect(outbox.state(event.id)).toMatchObject({ attempts: 2, lastError: null });
  });

  it('backs off exponentially across repeated failures', async () => {
    const { relay, publisher, outbox, record, clock } = setup();
    const event = record();
    publisher.failFor.add(event.id);
    const delays: number[] = [];

    for (let i = 0; i < 5; i++) {
      await relay.runOnce();
      const next = outbox.state(event.id)!.nextAttemptAt.getTime();
      delays.push(next - clock.now().getTime());
      clock.current = new Date(next);
    }

    // Each delay lies in [cap/2, cap] for cap = 1s, 2s, 4s, 8s, 8s (capped).
    [1000, 2000, 4000, 8000, 8000].forEach((cap, i) => {
      expect(delays[i]).toBeGreaterThanOrEqual(cap / 2);
      expect(delays[i]).toBeLessThanOrEqual(cap);
    });
  });

  it('holds back later events of an aggregate whose earlier event is undelivered', async () => {
    const { relay, publisher, record } = setup();
    const created = record('order-1', 'order.created');
    const cancelled = record('order-1', 'order.cancelled');
    const other = record('order-2', 'order.created');
    publisher.failFor.add(created.id);

    await relay.runOnce();

    expect(publisher.delivered.map((e) => e.id)).toEqual([other.id]);
    publisher.failFor.clear();
    await relay.runOnce(); // still backing off
    expect(publisher.delivered.map((e) => e.id)).not.toContain(cancelled.id);
  });

  it('never hands the same event to two concurrent drains', async () => {
    const { relay, publisher, record } = setup();
    for (let i = 0; i < 6; i++) record();

    const [first, second] = await Promise.all([relay.runOnce(), relay.runOnce()]);

    expect(first.published + second.published).toBe(6);
    expect(new Set(publisher.delivered.map((e) => e.id)).size).toBe(6);
  });

  it('drains a chain of events for one order within a single tick', async () => {
    const { relay, publisher, record } = setup();
    const created = record('order-1', 'order.created');
    const cancelled = record('order-1', 'order.cancelled');

    expect(await relay.drainAvailable()).toEqual({ published: 2, failed: 0 });
    expect(publisher.delivered.map((e) => e.id)).toEqual([created.id, cancelled.id]);
  });

  it('respects the batch size', async () => {
    const { outbox, publisher, record, clock } = setup();
    const relay = new OutboxRelay(outbox, publisher, clock, {
      outboxRelay: { ...config.outboxRelay, batchSize: 2 },
    } as AppConfig);
    for (let i = 0; i < 5; i++) record();

    expect(await relay.runOnce()).toEqual({ published: 2, failed: 0 });
  });
});
