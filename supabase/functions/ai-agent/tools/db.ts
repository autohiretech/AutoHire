// AutoHire — ai-agent DB helpers, mirroring the tiny utilities at the top of
// web/src/lib/supabaseClient.ts (same names, same behavior) so every tool's
// `run()` reads like the app code it's standing in for.

const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function mapRow<T>(row: Record<string, unknown> | null | undefined): T | undefined {
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const ck = toCamel(k);
    out[ck] = ck === 'ratingAvg' && typeof v === 'string' ? Number(v) : v;
  }
  return out as T;
}

export function mapRows<T>(rows: Record<string, unknown>[] | null | undefined): T[] {
  return (rows ?? []).map((r) => mapRow<T>(r) as T);
}

/** Await a PostgREST builder, throwing on error and returning data — same contract as supabaseClient.ts's `run()`. */
export async function run<D>(
  builder: PromiseLike<{ data: D; error: { message: string } | null }>,
): Promise<D> {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data;
}
