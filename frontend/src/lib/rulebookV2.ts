/**
 * Blink rulebook — normalized k·x + m·(1-x) = 1 pricing model.
 *
 * k = at-desk (plugged) multiplier, m = on-the-move (unplugged) multiplier.
 * x_expected = assumed proportion of time the device is plugged in.
 * The constraint ensures the blended per-second rate equals base_price at the
 * expected usage mix, keeping the model actuarially calibrated.
 *
 * The Battery API's `charging` signal is the risk proxy: plug = At Desk (k×),
 * unplug = On the Move (m×). Firefox/Safari lack the Battery API; unknown
 * charging state collapses to At Desk so those users are never penalised.
 */

export const MICRO_USDC_PER_USDC = 1_000_000;

/** Display-only GBP conversion factor. Never use for settlement. */
export const GBP_PER_USDC_DISPLAY_ONLY = 0.79;

export interface PricingConfig {
  /** At-desk (plugged) multiplier. */
  k: number;
  /** Assumed proportion of session time the device is plugged in (0–1). */
  x_expected: number;
  /** Expected per-second rate in USDC — baseline for the normalized model. */
  base_price_usdc_per_sec: number;
}

export const DEFAULT_PRICING: PricingConfig = {
  k: 0.8,
  x_expected: 0.5,
  base_price_usdc_per_sec: 0.000003,
};

/** Derives on-the-move multiplier from k and x so the constraint k·x + m·(1-x) = 1 holds. */
export function computeM(k: number, x: number): number {
  return (1 - k * x) / (1 - x);
}

// Backward-compat constants derived from DEFAULT_PRICING.
export const BASE_RATE_MICRO_USDC_PER_SEC = Math.round(
  DEFAULT_PRICING.base_price_usdc_per_sec * MICRO_USDC_PER_USDC,
); // 3

export const ON_THE_MOVE_MULTIPLIER = computeM(
  DEFAULT_PRICING.k,
  DEFAULT_PRICING.x_expected,
); // 1.2

export type PolicyMode = 'atDesk' | 'onTheMove';

export interface ScoreInput {
  /** Battery API charging signal — `true` = At Desk, `false` = On the Move. */
  charging?: boolean;
}

export interface ScoreOutput {
  charging: boolean | undefined;
  mode: PolicyMode;
  multiplier: number;
  microUsdcPerSec: number;
  reason: string;
}

export function modeFromCharging(charging: boolean | undefined): PolicyMode {
  return charging === false ? 'onTheMove' : 'atDesk';
}

export function scoreV2(
  input: ScoreInput,
  config: PricingConfig = DEFAULT_PRICING,
): ScoreOutput {
  const mode = modeFromCharging(input.charging);
  const m = computeM(config.k, config.x_expected);
  const multiplier = mode === 'onTheMove' ? m : config.k;
  const microUsdcPerSec = Math.round(
    config.base_price_usdc_per_sec * MICRO_USDC_PER_USDC * multiplier,
  );
  return {
    charging: input.charging,
    mode,
    multiplier,
    microUsdcPerSec,
    reason: mode === 'onTheMove' ? 'On the Move' : 'At Desk',
  };
}

export function microUsdcToUsdcDisplay(micro: number): string {
  return (micro / MICRO_USDC_PER_USDC).toFixed(6);
}

export function microUsdcToGbpDisplay(micro: number): string {
  const usdc = micro / MICRO_USDC_PER_USDC;
  return (usdc * GBP_PER_USDC_DISPLAY_ONLY).toFixed(6);
}
