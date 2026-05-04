/**
 * Beta-Bernoulli bandit for proactive-coach nudge timing.
 *
 * Problem: when should we ping a Pro user with a "session starter"
 * nudge? The fixed-time scheduler (8am for everyone) ignores per-user
 * circadian variance — a 7am person and a 10am person both get the
 * 8am ping, often missing the moment that would have actually
 * started a session. This module learns each user's best slot from
 * outcomes (did a session start within 30 min?) and Thompson-samples
 * a slot for each new day.
 *
 * Design:
 *   - One arm per (nudge_type, slot). For V1 the only enabled
 *     nudge_type is `morning_kickoff` and the slots are local hours
 *     "6", "7", "8", "9", "10".
 *   - Each arm has a Beta(α, β) posterior. α-1 = successes, β-1 = failures.
 *   - Per-user posterior is computed by counting that user's outcomes
 *     in coach_log. New users (<14 outcomes for this nudge_type)
 *     warm-start from the population posterior in nudge_slot_priors.
 *   - Thompson sampling: at decision time, sample a value from each
 *     arm's posterior; pick the arm with the highest sample. This
 *     gives an exploration/exploitation balance with no manual tuning.
 *
 * Determinism note: the bandit is randomised on purpose — that's the
 * exploration. We CACHE the day's pick in daily_nudge_plan so a single
 * day's hourly cron runs all read the same picked slot. Without that
 * cache, two cron invocations would sample different slots and the
 * downstream "is this hour the picked one?" check would be a coin
 * flip. The cron writes through this module's `getOrCreateDailyPlan`.
 */

import type { SupabaseClient as SbClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SbClient<any, 'public', any>;

/** Threshold below which we use population priors instead of per-user. */
export const PERSONAL_POSTERIOR_MIN_OBSERVATIONS = 14;

/** Slots where morning_kickoff is allowed to fire (user-local hours as text). */
export const MORNING_KICKOFF_SLOTS = ['6', '7', '8', '9', '10'] as const;

/** Beta posterior parameters for a single arm. */
export interface BetaPosterior {
  alpha: number;
  beta: number;
  /** Mean = alpha / (alpha + beta). Convenience for callers. */
  mean: number;
  /** Number of observations behind these parameters. 0 means uniform prior only. */
  n_observations: number;
}

/**
 * Sample a value from Beta(alpha, beta).
 *
 * Box-Muller-ish: a Beta(α, β) draw can be derived from two Gamma
 * draws — Beta = X / (X + Y) where X ~ Gamma(α, 1), Y ~ Gamma(β, 1).
 * For α, β >= 1 (our case, since priors start at (1, 1) and updates
 * only add) we use Marsaglia-Tsang's rejection method, which is the
 * standard Gamma sampler and runs in ~1.4 iterations on average.
 *
 * Math.random() is fine here — we don't need cryptographic randomness;
 * the bandit only needs unbiased samples. The day's draw is cached in
 * daily_nudge_plan so we don't re-roll mid-day.
 */
export function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  // Edge: when both are vanishingly small (very tight posteriors at
  // extreme α or β), x + y can be 0 in fp; default to the mean.
  const sum = x + y;
  if (sum <= 0) return alpha / (alpha + beta);
  return x / sum;
}

/** Marsaglia-Tsang Gamma(shape, 1) sampler. Requires shape >= 1. */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Boost: Gamma(α, 1) = Gamma(α + 1, 1) × U^(1/α) for α < 1
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleStandardNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Standard normal via Box-Muller. */
function sampleStandardNormal(): number {
  let u: number;
  let v: number;
  // Avoid log(0); reject if either is exactly 0.
  do {
    u = Math.random();
  } while (u === 0);
  do {
    v = Math.random();
  } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Read the per-user Beta posterior for a given (nudge_type, slot).
 * Counts observed coach_log rows where the user got this nudge at
 * this slot and the outcome was recorded. α = successes + 1, β =
 * failures + 1.
 *
 * Performance note: this issues one count query per slot via the
 * count={ exact, head: true } pattern. With 5 slots × N users × M
 * cron runs per day, the headers are cheap enough that we don't
 * pre-aggregate. If this gets hot, move to a single GROUP BY query.
 */
export async function getPersonalPosterior(
  supabase: Sb,
  userId: string,
  nudgeType: string,
  slot: string,
): Promise<BetaPosterior> {
  const [{ count: successCount }, { count: failureCount }] = await Promise.all([
    supabase
      .from('coach_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('nudge_type', nudgeType)
      .eq('nudge_slot', slot)
      .eq('outcome', true),
    supabase
      .from('coach_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('nudge_type', nudgeType)
      .eq('nudge_slot', slot)
      .eq('outcome', false),
  ]);

  const successes = successCount ?? 0;
  const failures = failureCount ?? 0;
  const alpha = 1 + successes;
  const beta = 1 + failures;
  return {
    alpha,
    beta,
    mean: alpha / (alpha + beta),
    n_observations: successes + failures,
  };
}

/**
 * Read the population-level Beta posterior for a given (nudge_type, slot).
 * Falls back to the uniform prior (1, 1) if the row is missing —
 * which only happens on a freshly migrated DB before the seed.
 */
export async function getPopulationPosterior(
  supabase: Sb,
  nudgeType: string,
  slot: string,
): Promise<BetaPosterior> {
  const { data } = await supabase
    .from('nudge_slot_priors')
    .select('alpha, beta, n_observations')
    .eq('nudge_type', nudgeType)
    .eq('slot', slot)
    .maybeSingle();

  const alpha = (data?.alpha as number | undefined) ?? 1;
  const beta = (data?.beta as number | undefined) ?? 1;
  const n = (data?.n_observations as number | undefined) ?? 0;
  return {
    alpha,
    beta,
    mean: alpha / (alpha + beta),
    n_observations: n,
  };
}

/**
 * Pick a slot via Thompson sampling.
 *
 * For each candidate, fetch the per-user posterior. If the user has
 * fewer than PERSONAL_POSTERIOR_MIN_OBSERVATIONS total (across all
 * slots for this nudge_type), use the population posterior instead —
 * sparse data on a per-user basis would be all uniform priors and
 * the bandit would explore at random for weeks.
 *
 * Returns the picked slot. Side-effect free.
 */
export async function pickSlot(
  supabase: Sb,
  userId: string,
  nudgeType: string,
  candidateSlots: readonly string[],
): Promise<{ slot: string; usedPersonal: boolean; samples: Record<string, number> }> {
  // Sum personal observations across all candidate slots first to
  // decide warm-start vs. personal posterior.
  const personalPosteriors: Record<string, BetaPosterior> = {};
  for (const slot of candidateSlots) {
    personalPosteriors[slot] = await getPersonalPosterior(supabase, userId, nudgeType, slot);
  }
  const totalPersonalObs = candidateSlots.reduce(
    (acc, s) => acc + personalPosteriors[s].n_observations,
    0,
  );
  const usePersonal = totalPersonalObs >= PERSONAL_POSTERIOR_MIN_OBSERVATIONS;

  // Pre-fetch population posteriors only when we need them — saves N
  // queries on hot users with rich personal histories.
  const populationPosteriors: Record<string, BetaPosterior> = {};
  if (!usePersonal) {
    for (const slot of candidateSlots) {
      populationPosteriors[slot] = await getPopulationPosterior(supabase, nudgeType, slot);
    }
  }

  const samples: Record<string, number> = {};
  let bestSlot = candidateSlots[0];
  let bestSample = -Infinity;
  for (const slot of candidateSlots) {
    const post = usePersonal ? personalPosteriors[slot] : populationPosteriors[slot];
    const draw = sampleBeta(post.alpha, post.beta);
    samples[slot] = draw;
    if (draw > bestSample) {
      bestSample = draw;
      bestSlot = slot;
    }
  }
  return { slot: bestSlot, usedPersonal: usePersonal, samples };
}

/**
 * Get-or-create-today's-plan: returns the planned slot for this user-
 * date-nudge_type tuple. First call samples + inserts; subsequent
 * calls read.
 *
 * The unique (user_id, date, nudge_type) constraint on
 * daily_nudge_plan handles the race: two simultaneous inserts of the
 * same plan have one win and the other 23505. We catch the conflict
 * and re-SELECT to return the winning row's slot.
 */
export async function getOrCreateDailyPlan(
  supabase: Sb,
  userId: string,
  nudgeType: string,
  candidateSlots: readonly string[],
  todayLocalDate: string, // YYYY-MM-DD in user's local tz
): Promise<{ slot: string; created: boolean; usedPersonal?: boolean }> {
  // Existing?
  const { data: existing } = await supabase
    .from('daily_nudge_plan')
    .select('planned_slot')
    .eq('user_id', userId)
    .eq('date', todayLocalDate)
    .eq('nudge_type', nudgeType)
    .maybeSingle();

  if (existing?.planned_slot) {
    return { slot: existing.planned_slot as string, created: false };
  }

  // Sample.
  const picked = await pickSlot(supabase, userId, nudgeType, candidateSlots);

  // Insert; tolerate race-loss.
  const { error: insertErr } = await supabase
    .from('daily_nudge_plan')
    .insert({
      user_id: userId,
      date: todayLocalDate,
      nudge_type: nudgeType,
      planned_slot: picked.slot,
    });

  if (insertErr) {
    const code = (insertErr as { code?: string }).code;
    if (code === '23505') {
      // Race-loser — read the winning slot.
      const { data: winner } = await supabase
        .from('daily_nudge_plan')
        .select('planned_slot')
        .eq('user_id', userId)
        .eq('date', todayLocalDate)
        .eq('nudge_type', nudgeType)
        .maybeSingle();
      return {
        slot: (winner?.planned_slot as string | undefined) ?? picked.slot,
        created: false,
      };
    }
    // Anything else — log and fall through to the sampled slot. Worst
    // case: cron runs disagree for one day; the next day's plan
    // captures cleanly.
    console.error('[nudge-bandit] daily_nudge_plan insert failed:', insertErr);
  }

  return { slot: picked.slot, created: true, usedPersonal: picked.usedPersonal };
}

/**
 * Record an outcome for a coach_log row. Called by the backfill cron
 * once the 30-min "did a session start?" window has elapsed.
 */
export async function recordOutcome(
  supabase: Sb,
  coachLogId: string,
  outcome: boolean,
): Promise<void> {
  await supabase
    .from('coach_log')
    .update({
      outcome,
      outcome_recorded_at: new Date().toISOString(),
    })
    .eq('id', coachLogId)
    .is('outcome', null); // idempotent — never overwrite a recorded outcome
}
