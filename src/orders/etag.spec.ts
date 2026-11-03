import { orderEtag, parseIfMatch } from './etag';

describe('order ETags', () => {
  it('round-trips the version', () => {
    expect(orderEtag(7)).toBe('"v7"');
    expect(parseIfMatch(orderEtag(7))).toEqual({ kind: 'version', version: 7 });
  });

  it('understands the wildcard and absence', () => {
    expect(parseIfMatch('*')).toEqual({ kind: 'any' });
    expect(parseIfMatch(undefined)).toBeUndefined();
  });

  it.each(['v7', '"7"', 'W/"v7"', '"v7", "v8"', ''])('flags %p as unparseable', (header) => {
    expect(parseIfMatch(header)).toEqual({ kind: 'unparseable' });
  });
});
