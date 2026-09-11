// A hard spend ceiling for one episode.
//
// The producer runs on a stronger model and the agent on a cheap one, so a
// token-only budget understated real spend and did not count the producer at
// all. This tracks dollars per model, and every API call in the episode checks
// it before spending more.
//
// Prices are DeepSeek's off-peak, cache-miss list rates: the weekly cron runs
// Wednesday 13:23 UTC, outside the peak windows (01:00–04:00 and 06:00–10:00
// UTC, weekdays). A manual run inside a peak window costs about double.

export type ModelPrice = { inPerMTok: number; outPerMTok: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "deepseek-v4-pro": { inPerMTok: 0.66, outPerMTok: 1.98 },
  "deepseek-flash": { inPerMTok: 0.15, outPerMTok: 0.6 },
};

// Unknown model: assume the dearest tier at peak so the ceiling errs on the safe side.
const FALLBACK_PRICE: ModelPrice = { inPerMTok: 1.32, outPerMTok: 3.96 };

export class CostBudget {
  private spentUsd = 0;

  constructor(private readonly ceilingUsd: number) {}

  record(model: string, inputTokens: number, outputTokens: number): void {
    const price = MODEL_PRICES[model] || FALLBACK_PRICE;
    this.spentUsd +=
      (inputTokens / 1e6) * price.inPerMTok + (outputTokens / 1e6) * price.outPerMTok;
  }

  get spent(): number {
    return Math.round(this.spentUsd * 100) / 100;
  }

  get remaining(): number {
    return Math.max(0, this.ceilingUsd - this.spentUsd);
  }

  get exhausted(): boolean {
    return this.spentUsd >= this.ceilingUsd;
  }
}
