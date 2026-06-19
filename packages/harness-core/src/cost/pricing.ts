/** USD price per 1k tokens. */
export interface Price {
  in: number;
  out: number;
}

/**
 * Price book: model id → per-1k token price. Populated at the composition root (from config).
 * Unknown models price to 0 so accounting never throws — but `has()` lets callers warn.
 */
export class PricingBook {
  private readonly prices = new Map<string, Price>();

  set(modelId: string, price: Price): this {
    this.prices.set(modelId, price);
    return this;
  }

  has(modelId: string): boolean {
    return this.prices.has(modelId);
  }

  costOf(modelId: string, tokensIn: number, tokensOut: number): number {
    const p = this.prices.get(modelId) ?? { in: 0, out: 0 };
    return (tokensIn / 1000) * p.in + (tokensOut / 1000) * p.out;
  }
}
