import { type WireEvent } from '../wire-format';
import { HttpEventPublisher } from './event-publisher';

const event: WireEvent = {
  id: '0b9a7c34-55d3-4f0e-9a8b-1c2d3e4f5a6b',
  type: 'order.created',
  specVersion: '1.0',
  source: 'pulso-orders-api',
  aggregateId: '7d0b5f8e-2c1a-4b6e-9f3a-1e2d3c4b5a69',
  occurredAt: '2026-06-01T10:00:00.000Z',
  data: {},
};

describe('HttpEventPublisher', () => {
  it('POSTs the event with its id as Idempotency-Key', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const publisher = new HttpEventPublisher('http://saga.test/events', 1000, fetchFn);

    await publisher.publish(event);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://saga.test/events');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': event.id, 'x-event-type': 'order.created' },
    });
    expect(JSON.parse(init.body)).toEqual(event);
  });

  it('treats non-2xx responses as failed deliveries', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const publisher = new HttpEventPublisher('http://saga.test/events', 1000, fetchFn);

    await expect(publisher.publish(event)).rejects.toThrow(/503/);
  });
});
