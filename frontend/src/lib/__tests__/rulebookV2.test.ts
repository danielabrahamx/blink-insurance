import { describe, it, expect } from 'vitest';
import {
  scoreV2,
  computeM,
  microUsdcToUsdcDisplay,
  microUsdcToGbpDisplay,
  MICRO_USDC_PER_USDC,
  BASE_RATE_MICRO_USDC_PER_SEC,
  GBP_PER_USDC_DISPLAY_ONLY,
  DEFAULT_PRICING,
} from '../rulebookV2';

describe('computeM — normalized constraint', () => {
  it('satisfies k·x + m·(1-x) = 1 for DEFAULT_PRICING', () => {
    const { k, x_expected } = DEFAULT_PRICING;
    const m = computeM(k, x_expected);
    const blended = k * x_expected + m * (1 - x_expected);
    expect(blended).toBeCloseTo(1, 10);
  });

  it('k=0.5 x=0.5 → m=1.5', () => {
    expect(computeM(0.5, 0.5)).toBeCloseTo(1.5, 10);
  });

  it('k=1.0 x=0.5 → m=1.0', () => {
    expect(computeM(1.0, 0.5)).toBeCloseTo(1.0, 10);
  });
});

describe('rulebookV2 backward-compat constants', () => {
  it('BASE_RATE_MICRO_USDC_PER_SEC is 3 (base price in µ-USDC)', () => {
    expect(BASE_RATE_MICRO_USDC_PER_SEC).toBe(3);
  });
});

describe('scoreV2 — mode resolution', () => {
  it('charging=true → At Desk, k multiplier', () => {
    const r = scoreV2({ charging: true });
    expect(r.mode).toBe('atDesk');
    expect(r.multiplier).toBeCloseTo(DEFAULT_PRICING.k);
    expect(r.charging).toBe(true);
    expect(r.reason).toBe('At Desk');
  });

  it('charging=false → On the Move, m multiplier', () => {
    const m = computeM(DEFAULT_PRICING.k, DEFAULT_PRICING.x_expected);
    const r = scoreV2({ charging: false });
    expect(r.mode).toBe('onTheMove');
    expect(r.multiplier).toBeCloseTo(m);
    expect(r.charging).toBe(false);
    expect(r.reason).toBe('On the Move');
  });

  it('unknown charging state collapses to At Desk (no Firefox/Safari penalty)', () => {
    const r = scoreV2({});
    expect(r.mode).toBe('atDesk');
    expect(r.charging).toBeUndefined();
    expect(r.reason).toBe('At Desk');
  });

  it('At Desk rate < On the Move rate (plugged is cheaper)', () => {
    const atDesk = scoreV2({ charging: true }).microUsdcPerSec;
    const onTheMove = scoreV2({ charging: false }).microUsdcPerSec;
    expect(atDesk).toBeLessThan(onTheMove);
  });

  it('custom config overrides default pricing', () => {
    const config = { k: 0.5, x_expected: 0.5, base_price_usdc_per_sec: 0.000003 };
    const m = computeM(0.5, 0.5); // 1.5
    const r = scoreV2({ charging: false }, config);
    expect(r.multiplier).toBeCloseTo(m);
  });
});

describe('microUsdc display helpers', () => {
  it('renders µ-USDC as a six-decimal USDC string', () => {
    expect(microUsdcToUsdcDisplay(0)).toBe('0.000000');
    expect(microUsdcToUsdcDisplay(3)).toBe('0.000003');
    expect(microUsdcToUsdcDisplay(MICRO_USDC_PER_USDC)).toBe('1.000000');
  });

  it('renders µ-USDC as a GBP display string via the fixed conversion', () => {
    expect(microUsdcToGbpDisplay(0)).toBe('0.000000');
    expect(microUsdcToGbpDisplay(MICRO_USDC_PER_USDC)).toBe(
      GBP_PER_USDC_DISPLAY_ONLY.toFixed(6),
    );
  });
});
