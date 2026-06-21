import { randomUUID } from 'node:crypto';
import type { ModelAlias, UntrustedContent } from '@apolla/contracts';
import type { ModelRouter } from '../router/router';
import type { PromptRegistry } from '../prompts/registry';
import { assembleRequest } from '../safety/untrusted';
import type { AgentOrchestrator, AgentEvent, ToolCall } from '../agent/orchestrator';

export interface SubAgentResult {
  index: number;
  subgoal: string;
  answer: string;
  toolCalls: number;
  ok: boolean;
}

export type CoworkEvent =
  | { type: 'plan'; subgoals: string[]; truncated: number }
  | { type: 'subagent-start'; index: number; subgoal: string }
  | { type: 'subagent-result'; index: number; result: SubAgentResult }
  | { type: 'synthesize'; text: string }
  | { type: 'done'; taskId: string; answer: string }
  | { type: 'error'; message: string };

export interface CoordinatorDeps {
  agent: AgentOrchestrator;
  router: ModelRouter;
  prompts: PromptRegistry;
  alias?: ModelAlias;
  /** Hard cap on sub-agents spawned per Cowork run (fan-out guard, default 5). */
  maxSubAgents?: number;
  /** Max sub-agents running at once (default 3). */
  concurrency?: number;
  idGen?: () => string;
}

export interface CoordinatorInput {
  ownerId: string;
  goal: string;
  subgoals: string[];
  taskId?: string;
  /** Approve a sub-agent low_write before it executes. Defaults to DENY (sub-agents never self-confirm). */
  approve?: (call: ToolCall) => Promise<boolean>;
  /** Answer a sub-agent's clarifying question. Defaults to null (background: never self-answer). */
  clarify?: (question: string) => Promise<string | null>;
}

/** Bounded concurrency map preserving input order; true parallelism within `cap`. */
async function mapPool<T, R>(items: T[], cap: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, worker));
  return results;
}

/**
 * Sub-agent coordinator (S6-T3, PRD §15.3). Fans a goal out to N bounded sub-agents — each a full
 * AgentOrchestrator run, so each inherits Safety tiers + the (background) approve policy + audit —
 * runs them in parallel under a hard count cap and a concurrency cap, then synthesizes one answer.
 * Sub-agents never self-confirm: writes go through the injected `approve`, which defaults to DENY.
 */
export class Coordinator {
  constructor(private readonly d: CoordinatorDeps) {}

  async *run(input: CoordinatorInput): AsyncIterable<CoworkEvent> {
    const alias = this.d.alias ?? 'gpt_premium';
    const max = this.d.maxSubAgents ?? 5;
    const concurrency = this.d.concurrency ?? 3;
    const taskId = input.taskId ?? (this.d.idGen ?? randomUUID)();

    const all = input.subgoals.filter((s) => s.trim().length > 0);
    const subgoals = all.slice(0, max);
    const truncated = all.length - subgoals.length; // fan-out guard: surface what we dropped

    yield { type: 'plan', subgoals, truncated };
    if (subgoals.length === 0) {
      yield { type: 'done', taskId, answer: '' };
      return;
    }
    for (let i = 0; i < subgoals.length; i++) yield { type: 'subagent-start', index: i, subgoal: subgoals[i]! };

    try {
      const results = await mapPool(subgoals, concurrency, (subgoal, i) => this.runSub(input, subgoal, i, taskId));
      for (const r of results) yield { type: 'subagent-result', index: r.index, result: r };

      const evidence: UntrustedContent[] = results.map((r) => ({
        kind: 'untrusted' as const,
        sourceId: `subagent-${r.index}`,
        origin: `subagent:${r.index}`,
        content: `Sub-goal ${r.index + 1}: ${r.subgoal}\nResult: ${r.answer}`,
      }));
      const system = this.d.prompts.render('cowork.synthesize').text;
      const answer = await this.d.router.completeText(alias, assembleRequest({ system, user: input.goal, data: evidence }));
      yield { type: 'synthesize', text: answer };
      yield { type: 'done', taskId, answer };
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Drain one sub-agent run into a structured result. */
  private async runSub(input: CoordinatorInput, subgoal: string, index: number, taskId: string): Promise<SubAgentResult> {
    let answer = '';
    let toolCalls = 0;
    let ok = false;
    const events: AsyncIterable<AgentEvent> = this.d.agent.run({
      ownerId: input.ownerId,
      goal: subgoal,
      taskId: `${taskId}:${index}`,
      approve: input.approve,
      clarify: input.clarify,
    });
    for await (const e of events) {
      if (e.type === 'tool-call') toolCalls++;
      else if (e.type === 'done') {
        answer = e.answer;
        ok = true;
      }
    }
    return { index, subgoal, answer, toolCalls, ok };
  }
}
