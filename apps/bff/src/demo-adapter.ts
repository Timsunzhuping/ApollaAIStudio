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

  /** JSON calls: agent step-decision, claims extraction (with data), or plan (without). */
  private buildJson(req: LLMRequest): string {
    const q = this.question(req);
    const data = req.data ?? [];

    // Agent step (S4): system prompt lists available tools and expects a call_tool/finish decision.
    const sys = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

    // Surfaces (S8): structured table / meeting notes / add-column.
    if (sys.includes('structured meeting notes')) {
      return JSON.stringify({
        summary: 'The team reviewed progress and agreed on next steps.',
        decisions: ['Ship the beta next week', 'Adopt the new pricing tiers'],
        actionItems: [
          { owner: 'Alice', task: 'Finalize the launch checklist', due: 'Friday' },
          { owner: 'Bob', task: 'Update the pricing page' },
        ],
      });
    }
    if (sys.includes('structured tables')) {
      if (sys.includes('Mode: addColumn')) return JSON.stringify({ values: ['yes', 'no', 'maybe', 'yes', 'no'] });
      return JSON.stringify({ columns: ['Option', 'Price', 'Rating'], rows: [['A', '$10', '4.5'], ['B', '$20', '4.0'], ['C', '$15', '4.8']] });
    }

    // Research extract (S25): return VERBATIM quotes from the provided chunks so the
    // orchestrator's programmatic quote verification passes in demo mode.
    if (sys.includes('verbatim quotation')) {
      const snippets = data.slice(0, 3).map((d) => {
        const line = (d.content.split('\n').find((l) => l.trim().length >= 40) ?? d.content).trim();
        return { sourceId: d.sourceId, quote: line.slice(0, 200), relevance: 'Directly addresses the sub-question.' };
      });
      return JSON.stringify({ snippets });
    }
    // Research compare (S25): claims over the provided snippet ids (status recomputed downstream).
    if (sys.includes('comparison stage')) {
      const ids = data.map((d) => d.sourceId);
      const claims: { claim: string; supportingSnippetIds: string[]; conflictingSnippetIds: string[]; status: string }[] = [];
      if (ids.length > 0) {
        claims.push({
          claim: `The evidence on ${q} points to continued measurable growth.`,
          supportingSnippetIds: ids.slice(0, Math.min(2, ids.length)),
          conflictingSnippetIds: [],
          status: 'single_source',
        });
      }
      if (ids.length > 2) {
        claims.push({
          claim: `Analysts differ on the pace of change for ${q}.`,
          supportingSnippetIds: [ids[2]!],
          conflictingSnippetIds: [],
          status: 'single_source',
        });
      }
      return JSON.stringify({ claims });
    }

    // Cowork plan (S6): break a goal into parallel sub-goals.
    if (sys.includes('sub-goal')) {
      return JSON.stringify({
        subgoals: [
          `Background and key definitions for ${q}`,
          `Current state and recent developments in ${q}`,
          `Outlook, risks, and implications of ${q}`,
        ],
      });
    }
    if (sys.includes('Available tools:')) {
      if (!sys.includes('(none)')) {
        return JSON.stringify({ action: 'finish', answer: `Done — completed "${q}" using the available tools. _(demo agent)_` });
      }
      const tools = [...sys.matchAll(/- (\S+) \[(\w+)\]/g)].map((m) => ({ name: m[1]!, risk: m[2]! }));
      const writeTool = tools.find((t) => t.risk === 'low_write');
      if (/save|note|保存|写入|记录/i.test(q) && writeTool) {
        return JSON.stringify({ action: 'call_tool', tool: writeTool.name, args: { text: q } });
      }
      return JSON.stringify({ action: 'call_tool', tool: 'web_search', args: { query: q } });
    }

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

    // Writer (S7): edit the provided document per the instruction. Returns a clearly-changed doc.
    const sys = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    if (sys.includes('document editor') && data[0]) {
      return `${data[0].content}\n\n_(edited per instruction: ${q} — demo Writer)_`;
    }
    // Translator (S8): return a clearly-translated, structure-preserving doc offline.
    if (sys.includes('professional translator') && data[0]) {
      return `> _Translated (demo)_\n\n${data[0].content}`;
    }
    // Chat (S28): conversational reply grounded in the last user turn.
    if (sys.includes('helpful assistant')) {
      return `你好！关于「${q.slice(0, 80)}」：这是离线演示模式的回复 — 接入真实模型 key 后这里会是真正的对话。需要带来源的答案请用 Research。`;
    }
    // Compaction (S28): terse bullet summary of the transcript.
    if (sys.includes('compact briefing') || sys.includes('Summarize the following conversation')) {
      return '- 早前对话要点（演示摘要）';
    }
    // Cited synthesis (S25): the data channel holds verified quotes → cite them as [^snippetId].
    if (sys.includes('footnote')) {
      const lines = data.map((d) => `${d.content.replace(/\s+/g, ' ').trim()} [^${d.sourceId}]`);
      return [
        `## Overview`,
        `This report answers **${q}** from verified quotes.`,
        ``,
        `## Findings`,
        ...lines.map((l) => `${l}\n`),
        `_Demo synthesis (offline mode). Connect model keys for full analysis._`,
      ].join('\n');
    }
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
