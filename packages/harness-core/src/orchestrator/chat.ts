import { randomUUID } from 'node:crypto';
import type { ChatMode, Conversation, LLMMessage, ModelAlias, RouteConfig } from '@apolla/contracts';
import { getRoute } from '@apolla/config';
import { ModelRouter } from '../router/router';
import type { LLMAdapter } from '../router/types';
import { PromptRegistry } from '../prompts/registry';
import { InMemoryCostLedger } from '../cost/ledger';
import type { ConversationRepository } from '../repo/types';

export interface ChatDeps {
  adapters: Map<string, LLMAdapter>;
  prompts: PromptRegistry;
  conversations: ConversationRepository;
  ledger: InMemoryCostLedger;
  routeFor?: (alias: ModelAlias) => RouteConfig;
  env?: NodeJS.ProcessEnv;
  idGen?: () => string;
  now?: () => Date;
  /** Total transcript chars that trigger auto-compaction (PRD §12.F). */
  compactThresholdChars?: number;
  /** Recent user turns kept verbatim through compaction. */
  keepRecentTurns?: number;
}

export interface ChatTurnInput {
  ownerId: string;
  conversationId?: string;
  mode?: ChatMode;
  text: string;
}

export type ChatEvent =
  | { type: 'conversation'; conversationId: string; title: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; conversationId: string; alias: ModelAlias; compacted: boolean; costUsd: number }
  | { type: 'error'; message: string };

export const COMPACT_PREFIX = '[对话摘要 — 早前轮次已压缩]';

/**
 * PRD §6.1 routing: explicit GPT/Claude map to their family defaults; auto sends
 * writing-shaped turns to claude_write and everything else to gpt_fast.
 */
export function aliasForTurn(mode: ChatMode | undefined, text: string): ModelAlias {
  if (mode === 'gpt') return 'gpt_fast';
  if (mode === 'claude') return 'claude_write';
  const writingIntent =
    /改写|润色|扩写|缩写|翻译|语气|文案|邮件|rewrite|polish|rephrase|tone|draft an email/i.test(text) ||
    text.length > 1500;
  return writingIntent ? 'claude_write' : 'gpt_fast';
}

/** Fold old turns into one summary message; system stays; recent turns survive verbatim. */
export function compactMessages(
  messages: LLMMessage[],
  opts: { thresholdChars: number; keepRecentTurns: number; summarize: (transcript: string) => Promise<string> },
): Promise<{ messages: LLMMessage[]; compacted: boolean }> {
  const total = messages.reduce((n, m) => n + m.content.length, 0);
  if (total <= opts.thresholdChars) return Promise.resolve({ messages, compacted: false });

  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  let userSeen = 0;
  let cut = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i]!.role === 'user') {
      userSeen++;
      if (userSeen >= opts.keepRecentTurns) {
        cut = i;
        break;
      }
    }
  }
  const old = rest.slice(0, cut);
  const recent = rest.slice(cut);
  if (old.length === 0) return Promise.resolve({ messages, compacted: false });

  const transcript = old
    .map((m) => `${m.role}: ${m.content.startsWith(COMPACT_PREFIX) ? m.content.slice(COMPACT_PREFIX.length) : m.content}`)
    .join('\n');
  return opts.summarize(transcript).then((summary) => ({
    messages: [...system, { role: 'assistant' as const, content: `${COMPACT_PREFIX}\n${summary}` }, ...recent],
    compacted: true,
  }));
}

/**
 * Chat orchestrator (S28 / PRD §6.1): load history → auto-compact past the threshold →
 * route by mode/intent → stream → persist. Every LLM call is metered into the cost ledger
 * under the conversation id.
 */
export class ChatOrchestrator {
  private readonly d: ChatDeps;

  constructor(deps: ChatDeps) {
    this.d = deps;
  }

  async *run(input: ChatTurnInput): AsyncIterable<ChatEvent> {
    const idGen = this.d.idGen ?? (() => randomUUID());
    const now = () => (this.d.now ? this.d.now() : new Date()).toISOString();
    const router = new ModelRouter({
      adapters: this.d.adapters,
      routeFor: this.d.routeFor ?? getRoute,
      env: this.d.env,
      onUsage: (e) => this.d.ledger.recordLLM(e, { taskId: convo.id }),
    });

    let convo: Conversation;
    try {
      const existing = input.conversationId ? await this.d.conversations.get(input.conversationId) : undefined;
      if (input.conversationId && (!existing || existing.ownerId !== input.ownerId)) {
        yield { type: 'error', message: 'unknown conversation' };
        return;
      }
      convo = existing ?? {
        id: idGen(),
        ownerId: input.ownerId,
        title: input.text.slice(0, 60),
        messages: [{ role: 'system', content: this.d.prompts.render('chat.system').text }],
        compacted: false,
        createdAt: now(),
        updatedAt: now(),
      };
      if (!existing) await this.d.conversations.create(convo);
      yield { type: 'conversation', conversationId: convo.id, title: convo.title };

      const withUser: LLMMessage[] = [...convo.messages, { role: 'user', content: input.text }];
      const { messages, compacted } = await compactMessages(withUser, {
        thresholdChars: this.d.compactThresholdChars ?? 24_000,
        keepRecentTurns: this.d.keepRecentTurns ?? 4,
        summarize: async (transcript) => {
          let summary = '';
          const req = {
            messages: [
              { role: 'system' as const, content: this.d.prompts.render('chat.compact').text },
              { role: 'user' as const, content: transcript },
            ],
            data: [],
          };
          for await (const chunk of router.complete('gpt_fast', req)) summary += chunk.delta;
          return summary.trim();
        },
      }).catch(() => ({ messages: withUser, compacted: false })); // compaction must never block the turn

      const alias = aliasForTurn(input.mode, input.text);
      let reply = '';
      for await (const chunk of router.complete(alias, { messages, data: [] })) {
        reply += chunk.delta;
        if (chunk.delta) yield { type: 'delta', text: chunk.delta };
      }

      convo.messages = [...messages, { role: 'assistant', content: reply }];
      convo.compacted = convo.compacted || compacted;
      convo.updatedAt = now();
      await this.d.conversations.save(convo);
      yield { type: 'done', conversationId: convo.id, alias, compacted, costUsd: this.d.ledger.totalUsd(convo.id) };
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
}
