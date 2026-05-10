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

/** Default per-task ceiling. Anthropic + Meta combined latency for a
 *  single user nudge sits comfortably under 8s on a healthy day; 20s
 *  is "something is genuinely wrong" territory. The cap prevents one
 *  hung upstream from holding a worker slot indefinitely and starving
 *  the rest of the queue.
 *
 *  Crons set their own override via the `taskTimeoutMs` option; this
 *  is just the safe default. */
const DEFAULT_TASK_TIMEOUT_MS = 20_000;

export interface ConcurrentMapOptions {
  /** Per-task timeout in ms. Default 20_000. Set to 0 to disable. */
  taskTimeoutMs?: number;
}

/**
 * Run `worker` for each item in `items` with at most `concurrency` workers
 * in flight at once. Returns an array of results in input order.
 *
 * Failure modes:
 *  - Worker throws → captured into result slot, remaining work continues.
 *  - Worker exceeds taskTimeoutMs → result slot gets a `{ ok: false,
 *    error: TimeoutError }`, the worker slot moves on. The hung
 *    underlying promise is left dangling (Node will gc it eventually)
 *    rather than blocking the whole cron — losing one user's nudge is
 *    better than losing every user's nudge.
 *
 * Why per-task timeouts matter: at concurrency 10 with one wedged
 * Anthropic call, the previous implementation could pin 1/10th of
 * throughput indefinitely. Vercel's function timeout would eventually
 * kill the whole route, recordCronRun never fires, the cron looks
 * never-ran to the watchdog. With this guardrail the cron always
 * makes forward progress.
 */
export async function concurrentMap<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  options?: ConcurrentMapOptions,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const timeoutMs = options?.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> =
    new Array(items.length);

  let nextIndex = 0;
  async function workerLoop() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        const taskPromise = worker(items[i], i);
        const value = timeoutMs > 0
          ? await Promise.race([
              taskPromise,
              new Promise<R>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`task ${i} timed out after ${timeoutMs}ms`)),
                  timeoutMs,
                ),
              ),
            ])
          : await taskPromise;
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
