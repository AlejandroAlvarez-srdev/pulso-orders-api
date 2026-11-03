import { InvalidCursorError } from '../../common/domain-errors';
import { decodeCursor, encodeCursor, isAfterCursor } from './cursor';

const id = '7d0b5f8e-2c1a-4b6e-9f3a-1e2d3c4b5a69';

describe('order cursor', () => {
  it('round-trips through base64url', () => {
    const cursor = { createdAt: new Date('2026-05-01T12:00:00.000Z'), id };
    const encoded = encodeCursor(cursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ['garbage', '%%%'],
    ['non-object JSON', Buffer.from('42').toString('base64url')],
    ['bad date', Buffer.from(JSON.stringify({ c: 'nope', i: id })).toString('base64url')],
    ['bad id', Buffer.from(JSON.stringify({ c: new Date().toISOString(), i: 'x' })).toString('base64url')],
  ])('rejects %s', (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(InvalidCursorError);
  });

  it('orders by createdAt desc then id desc', () => {
    const cursor = { createdAt: new Date('2026-05-01T12:00:00Z'), id: '5' };

    expect(isAfterCursor({ createdAt: new Date('2026-05-01T11:59:59Z'), id: '9' }, cursor)).toBe(true);
    expect(isAfterCursor({ createdAt: new Date('2026-05-01T12:00:00Z'), id: '4' }, cursor)).toBe(true);
    expect(isAfterCursor({ createdAt: new Date('2026-05-01T12:00:00Z'), id: '5' }, cursor)).toBe(false);
    expect(isAfterCursor({ createdAt: new Date('2026-05-01T12:00:01Z'), id: '0' }, cursor)).toBe(false);
  });
});
