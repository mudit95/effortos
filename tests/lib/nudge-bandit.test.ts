import { describe, it, expect } from 'vitest';
import { sampleBeta } from '@/lib/nudge-bandit';

/**
 * Bandit math tests. We can't run the full pickSlot path without a
 * Supabase double here (none of the existing test infra mocks
 * supabase-js); instead we verify the underlying `sampleBeta` is
 * statistically sound. With a few thousand draws the empirical mean
 * should be within ~1% of the theoretical Beta mean — that's enough
 * to catch arithmetic regressions in the Gamma sampler.
 */
describe('sampleBeta', () => {
  it('approximates the theoretical mean for Beta(1, 1) (uniform)', () => {
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) sum += sampleBeta(1, 1);
    const empiricalMean = sum / n;
    // Theoretical mean = 1 / (1+1) = 0.5
    expect(empiricalMean).toBeGreaterThan(0.46);
    expect(empiricalMean).toBeLessThan(0.54);
  });

  it('approximates the theoretical mean for Beta(5, 2)', () => {
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) sum += sampleBeta(5, 2);
    const empiricalMean = sum / n;
    // Theoretical mean = 5 / (5+2) = 0.7142...
    expect(empiricalMean).toBeGreaterThan(0.69);
    expect(empiricalMean).toBeLessThan(0.74);
  });

  it('approximates the theoretical mean for Beta(2, 8)', () => {
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) sum += sampleBeta(2, 8);
    const empiricalMean = sum / n;
    // Theoretical mean = 2 / 10 = 0.2
    expect(empiricalMean).toBeGreaterThan(0.18);
    expect(empiricalMean).toBeLessThan(0.22);
  });

  it('handles tight Beta(50, 50) without falling out of [0, 1]', () => {
    for (let i = 0; i < 1000; i++) {
      const x = sampleBeta(50, 50);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });

  it('handles asymmetric Beta(0.5, 0.5) (boost path for shape < 1)', () => {
    // Beta(0.5, 0.5) is U-shaped — exercises the sampleGamma boost
    // branch where shape < 1 and we recurse with shape + 1.
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) sum += sampleBeta(0.5, 0.5);
    const empiricalMean = sum / n;
    // Mean = 0.5 / (0.5 + 0.5) = 0.5
    expect(empiricalMean).toBeGreaterThan(0.45);
    expect(empiricalMean).toBeLessThan(0.55);
  });
});

describe('sampleBeta — deterministic edge cases', () => {
  it('never returns NaN even under numeric stress', () => {
    // Very lopsided posteriors are common when a slot has lots of
    // failures and few successes. Make sure we don't NaN out.
    for (let i = 0; i < 1000; i++) {
      const x = sampleBeta(1.1, 999);
      expect(Number.isNaN(x)).toBe(false);
      expect(Number.isFinite(x)).toBe(true);
    }
  });
});
