-- Per-order delivery order followed occurred_at, which is stamped by the writer's
-- clock: with two replicas whose clocks disagree, an order.cancelled committed after
-- order.created could carry an earlier timestamp and be delivered first. A database
-- sequence assigned at insert follows commit order for the events of one order,
-- because their transactions serialize on the order row.

CREATE SEQUENCE "outbox_events_seq_seq";
ALTER TABLE "outbox_events" ADD COLUMN "seq" BIGINT;

-- Existing rows keep the order the relay used before this migration.
UPDATE "outbox_events" e
SET "seq" = ordered.n
FROM (SELECT "id", row_number() OVER (ORDER BY "occurred_at", "id") AS n FROM "outbox_events") ordered
WHERE e."id" = ordered."id";
SELECT setval('"outbox_events_seq_seq"', COALESCE((SELECT max("seq") FROM "outbox_events"), 0) + 1, false);

ALTER TABLE "outbox_events"
  ALTER COLUMN "seq" SET DEFAULT nextval('"outbox_events_seq_seq"'),
  ALTER COLUMN "seq" SET NOT NULL;
ALTER SEQUENCE "outbox_events_seq_seq" OWNED BY "outbox_events"."seq";

-- DropIndex
DROP INDEX "outbox_events_aggregate_id_published_at_occurred_at_idx";

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_id_published_at_seq_idx" ON "outbox_events"("aggregate_id", "published_at", "seq");
