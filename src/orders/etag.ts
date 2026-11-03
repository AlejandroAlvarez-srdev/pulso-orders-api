/**
 * Strong ETag derived from the optimistic-locking version: it changes on every
 * write to the order, which is exactly what If-Match needs to detect.
 */
export function orderEtag(version: number): string {
  return `"v${version}"`;
}

export type IfMatch = { kind: 'any' } | { kind: 'version'; version: number } | { kind: 'unparseable' };

/** Parses a single-entity `If-Match` (or `If-None-Match`) header. Returns undefined when absent. */
export function parseIfMatch(header: string | undefined): IfMatch | undefined {
  if (header === undefined) return undefined;
  const value = header.trim();
  if (value === '*') return { kind: 'any' };
  const match = /^"v(\d{1,9})"$/.exec(value);
  return match ? { kind: 'version', version: Number(match[1]) } : { kind: 'unparseable' };
}
