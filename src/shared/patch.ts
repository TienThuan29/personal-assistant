const norm = (v: unknown): unknown => (v === '' || v === undefined ? null : v);

/** The fields of `values` that differ from `before` ('' and undefined count as null, so a cleared field comes out as null). */
export function diffPatch(before: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, norm(v)]).filter(([k, v]) => v !== norm(before[k as string])));
}
