# Event contracts

JSON Schemas (draft 2020-12) for the events `pulso-orders-api` publishes through its outbox.
They are the source of truth shared with **pulso-saga**: the producer's contract tests
(`test/contracts.e2e-spec.ts`) validate real events against these files, and consumers should
validate against the same files, vendored at the same version.

| Event | Schema | Emitted when |
| --- | --- | --- |
| `order.created` | `events/order.created.v1.schema.json` | `POST /orders` commits a new order |
| `order.cancelled` | `events/order.cancelled.v1.schema.json` | an order transitions to `CANCELLED` |

All events share `events/envelope.v1.schema.json`. Delivery is at-least-once, so deduplicate on
`id`. Events of one order arrive in the order they happened.

## Evolving a contract

- **Compatible changes** (new optional field, new event type) stay in `v1`. Consumers must
  ignore event types they do not know. Data objects are `additionalProperties: false` here so the
  producer tests catch accidental fields, but consumers should not depend on that.
- **Breaking changes** (removing or renaming a field, changing a type or meaning) need a new
  file (`order.created.v2.schema.json`) and a new `type` or `specVersion`. Both versions are
  published until every consumer has moved over.
- `previousStatus` in `order.cancelled` is limited to the statuses that can be cancelled. If the
  state machine changes, this schema has to change too, and a test enforces that.
