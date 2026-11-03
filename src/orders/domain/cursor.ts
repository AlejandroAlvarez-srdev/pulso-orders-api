import { InvalidCursorError } from '../../common/domain-errors';

/**
 * Keyset position in the (createdAt DESC, id DESC) ordering. Using the id as a
 * tie-breaker keeps pagination stable when many orders share a timestamp.
 */
export interface OrderCursor {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: OrderCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })).toString('base64url');
}

export function decodeCursor(raw: string): OrderCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError('Cursor is not valid base64url-encoded JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidCursorError('Cursor has an unexpected shape');
  }
  const { c, i } = parsed as Record<string, unknown>;
  const createdAt = typeof c === 'string' ? new Date(c) : undefined;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || typeof i !== 'string' || !UUID.test(i)) {
    throw new InvalidCursorError('Cursor has an unexpected shape');
  }
  return { createdAt, id: i };
}

/** True when `order` sorts strictly after `cursor` in (createdAt DESC, id DESC). */
export function isAfterCursor(order: OrderCursor, cursor: OrderCursor): boolean {
  const delta = order.createdAt.getTime() - cursor.createdAt.getTime();
  return delta < 0 || (delta === 0 && order.id < cursor.id);
}
