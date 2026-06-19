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

  private buildJson(req: LLMRequest): string {
    const q = this.question(req);
    const data = req.data ?? [];

    if (data.length === 0) {
      // PLAN
      return JSON.stringify({
        subquestions: [
          `Background and key definitions for ${q}`,
          `Current state, data, and recent developments in ${q}`,
          `Outlook, risks, and implications of ${q}`,
        ],
        estimateSeconds: 75,
      });
    }

    // SYNTHESIZE — ground each claim in a real source from the data channel.
    const claims = data.map((d) => ({
      claim: d.content.split('\n')[0] ?? d.sourceId,
      sourceIds: [d.sourceId],
    }));
    const bullets = data.map((d) => `- ${d.content.split('\n')[0] ?? ''} [${d.sourceId}]`).join('\n');
    const report = [
      `## Overview`,
      `This report summarizes the available evidence on **${q}**.`,
      ``,
      `## Key findings`,
      bullets,
      ``,
      `_Demo synthesis (offline mode). Connect model keys for full analysis._`,
    ].join('\n');
    return JSON.stringify({ report, claims });
  }

  stream(_modelId: string, req: LLMRequest): LLMStream {
    const text = this.buildJson(req);
    async function* gen() {
      yield { delta: text, done: false };
      yield { delta: '', done: true };
    }
    const usage: TokenUsage = { tokensIn: 200, tokensOut: 400 };
    return { stream: gen(), usage: Promise.resolve(usage) };
  }

  async json(_modelId: string, req: LLMRequest, _schema: object, _opts: CallOpts): Promise<JsonResult> {
    return { text: this.buildJson(req), usage: { tokensIn: 200, tokensOut: 400 } };
  }
}
