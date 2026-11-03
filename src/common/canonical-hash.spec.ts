import { canonicalHash } from './canonical-hash';

describe('canonicalHash', () => {
  it('ignores object key order at every depth', () => {
    expect(canonicalHash({ a: 1, b: { c: [1, { d: 2, e: 3 }] } })).toBe(
      canonicalHash({ b: { c: [1, { e: 3, d: 2 }] }, a: 1 }),
    );
  });

  it('is sensitive to array order and values', () => {
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
    expect(canonicalHash({ qty: 1 })).not.toBe(canonicalHash({ qty: 2 }));
  });
});
