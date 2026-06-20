import type { LLMRequest } from '@apolla/contracts';
import type { LLMAdapter, LLMStream, JsonResult, CallOpts, TokenUsage } from '@apolla/harness-core';

/**
 * Offline demo LLM adapter — lets `pnpm dev` run the full research→artifact loop with no API
 * keys. It produces question- and evidence-specific JSON so the demo looks real, while staying
 * deterministic. With real keys, the composition root swaps in OpenAI/Anthropic adapters instead.
 *
 * Plan vs synthesize is distinguished by the presence of evidence in the data channel.
 */
export class DemoLLMAdapter implements LLMAdapter {
  readonly provider = 'demo';

  private question(req: LLMRequest): string {
    const user = [...req.messages].reverse().find((m) => m.role === 'user');
    return user?.content?.trim() || 'the topic';
  }

  /** JSON calls: with data → claims extraction; without data → plan (ARCHITECTURE §3.5/S2-T9). */
  private buildJson(req: LLMRequest): string {
    const q = this.question(req);
    const data = req.data ?? [];
    if (data.length === 0) {
      return JSON.stringify({
        subquestions: [
          `Background and key definitions for ${q}`,
          `Current state, data, and recent developments in ${q}`,
          `Outlook, risks, and implications of ${q}`,
        ],
        estimateSeconds: 75,
      });
    }
    return JSON.stringify({
      claims: data.map((d) => ({ claim: d.content.split('\n')[0] ?? d.sourceId, sourceIds: [d.sourceId] })),
    });
  }

  /** Prose report streamed token-by-token, grounded in the data channel. */
  private buildProse(req: LLMRequest): string {
    const q = this.question(req);
    const data = req.data ?? [];
    const bullets = data.map((d) => `- ${d.content.split('\n')[0] ?? ''} [${d.sourceId}]`).join('\n');
    return [
      `## Overview`,
      `This report summarizes the available evidence on **${q}**.`,
      ``,
      `## Key findings`,
      bullets,
      ``,
      `_Demo synthesis (offline mode). Connect model keys for full analysis._`,
    ].join('\n');
  }

  stream(_modelId: string, req: LLMRequest): LLMStream {
    const text = this.buildProse(req);
    async function* gen() {
      for (const word of text.split(/(\s+)/)) yield { delta: word, done: false };
      yield { delta: '', done: true };
    }
    return { stream: gen(), usage: Promise.resolve({ tokensIn: 200, tokensOut: 400 } as TokenUsage) };
  }

  async json(_modelId: string, req: LLMRequest, _schema: object, _opts: CallOpts): Promise<JsonResult> {
    return { text: this.buildJson(req), usage: { tokensIn: 200, tokensOut: 400 } };
  }
}
