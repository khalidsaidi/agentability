// A hard spend ceiling for one episode.
//
// The producer runs on a frontier model and the agent on a cheap one, so a
// token-only budget understated real spend by more than an order of magnitude
// and did not count the producer at all. This tracks dollars per model, and
// every API call in the episode checks it before spending more.

export type ModelPrice = { inPerMTok: number; outPerMTok: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5": { inPerMTok: 15, outPerMTok: 75 },
  "claude-haiku-4-5": { inPerMTok: 1, outPerMTok: 5 },
};

const FALLBACK_PRICE: ModelPrice = { inPerMTok: 15, outPerMTok: 75 };

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
