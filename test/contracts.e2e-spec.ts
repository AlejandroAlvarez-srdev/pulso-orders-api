import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { OrderStatus } from '../src/orders/domain/order';
import { ORDER_TRANSITIONS } from '../src/orders/domain/order-state-machine';
import { type EventPublisher } from '../src/outbox/relay/event-publisher';
import { type WireEvent } from '../src/outbox/wire-format';
import { createTestApp, newKey, orderBody, type TestApp } from './test-app';

const CONTRACTS_DIR = join(__dirname, '..', 'contracts', 'events');
const SCHEMA_BASE = 'https://contracts.pulso.example/events/';

function loadContracts(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const file of readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(join(CONTRACTS_DIR, file), 'utf8')));
  }
  return ajv;
}

describe('event contracts shared with pulso-saga', () => {
  const ajv = loadContracts();
  const validatorFor = (type: string): ValidateFunction => {
    const validate = ajv.getSchema(`${SCHEMA_BASE}${type}.v1.schema.json`);
    if (!validate) throw new Error(`No contract for event type ${type}`);
    return validate;
  };
  const expectValid = (event: unknown, type: string) => {
    const validate = validatorFor(type);
    expect({ valid: validate(event), errors: validate.errors ?? null }).toEqual({ valid: true, errors: null });
  };

  const delivered: WireEvent[] = [];
  const publisher: EventPublisher = { publish: async (event) => void delivered.push(event) };
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ publisher });
    const token = await t.token();
    const createAndCancelFrom = async (path: string[]) => {
      const { body } = await t
        .http()
        .post('/orders')
        .auth(token, { type: 'bearer' })
        .set('Idempotency-Key', newKey())
        .send(orderBody({ items: [{ sku: 'FARM-1', name: 'Gel antibacterial', qty: 3 }] }))
        .expect(201);
      for (const status of [...path, 'CANCELLED']) {
        await t
          .http()
          .post(`/orders/${body.id}/transitions`)
          .auth(token, { type: 'bearer' })
          .send({ status, reason: status === 'CANCELLED' && path.length ? 'Pulser unavailable' : undefined })
          .expect(200);
      }
    };
    await createAndCancelFrom([]);
    await createAndCancelFrom(['PAYMENT_PENDING', 'PAID', 'ASSIGNED']);
    await t.relay.drainAvailable();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('delivers only event types that have a contract', () => {
    const types = new Set(delivered.map((e) => e.type));

    expect([...types].sort()).toEqual(['order.cancelled', 'order.created']);
    types.forEach((type) => expect(() => validatorFor(type)).not.toThrow());
  });

  it('every delivered event satisfies its schema', () => {
    expect(delivered).toHaveLength(4);
    delivered.forEach((event) => expectValid(event, event.type));
  });

  it('order.cancelled covers a null and a non-null reason', () => {
    const reasons = delivered.filter((e) => e.type === 'order.cancelled').map((e) => (e.data as { reason: unknown }).reason);

    expect(reasons).toEqual([null, 'Pulser unavailable']);
  });

  it('previousStatus in order.cancelled matches the state machine', () => {
    const schema = JSON.parse(readFileSync(join(CONTRACTS_DIR, 'order.cancelled.v1.schema.json'), 'utf8'));
    const cancellable = Object.values(OrderStatus).filter((s) => ORDER_TRANSITIONS[s].includes(OrderStatus.CANCELLED));

    expect(schema.properties.data.properties.previousStatus.enum).toEqual(cancellable);
  });

  describe('rejects payloads that would break consumers', () => {
    const created = () => structuredClone(delivered.find((e) => e.type === 'order.created')!) as WireEvent & {
      data: Record<string, unknown>;
    };

    it.each<[string, (e: ReturnType<typeof created>) => void]>([
      ['a missing amount', (e) => delete e.data.amountCents],
      ['a fractional amount', (e) => (e.data.amountCents = 10.5)],
      ['another currency', (e) => (e.data.currency = 'USD')],
      ['an unknown field', (e) => (e.data.tip = 100)],
      ['a non-uuid id', (e) => (e.id = 'evt-1')],
      ['a local timestamp', (e) => (e.occurredAt = '01/06/2026 10:00')],
      ['an empty item list', (e) => (e.data.items = [])],
      ['a wrong spec version', (e) => ((e as { specVersion: string }).specVersion = '2.0')],
    ])('%s', (_label, mutate) => {
      const event = created();
      mutate(event);

      expect(validatorFor('order.created')(event)).toBe(false);
    });
  });
});
