/**
 * Bounded-concurrency helpers for cron jobs.
 *
 * The cron handlers (morning/afternoon/nightly email + coach) loop over
 * eligible users serially. At ~500 active users that's a 5-10 minute run,
 * which exceeds the Vercel Hobby 60s and bumps up against Pro's 300s.
 * Wrap with concurrentMap to do work in parallel batches.
 *
 * Why a tiny in-house helper instead of `p-limit`: keeps the dependency
 * tree honest, the API surface is one function, and we already have the
 * surrounding telemetry. Trade-off accepted.
 */

/**
 * Run `worker` for each item in `items` with at most `concurrency` workers
 * in flight at once. Returns an array of results in input order.
 *
 * If a worker throws, the error is captured into the result slot and the
 * remaining items continue — we don't want one failed user to halt the
 * entire cron run. Callers inspect `result.error` to surface failures.
 */
export async function concurrentMap<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> =
    new Array(items.length);

  let nextIndex = 0;
  async function workerLoop() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { ok: true, value };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }

  const workers = Array.from({ length: limit }, () => workerLoop());
  await Promise.all(workers);
  return results;
}
