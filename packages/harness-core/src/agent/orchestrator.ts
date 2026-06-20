import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ModelAlias, UntrustedContent } from '@apolla/contracts';
import type { ModelRouter } from '../router/router';
import type { ToolRuntime } from '../tools/runtime';
import type { PromptRegistry } from '../prompts/registry';
import { SafetyPolicy } from '../safety/policy';
import { assembleRequest } from '../safety/untrusted';

export interface ToolCall {
  tool: string;
  args: unknown;
  risk: string;
}

export interface AgentRunInput {
  ownerId: string;
  goal: string;
  taskId?: string;
  /** Approve a low-risk write before it executes. Defaults to DENY (safe) — agents never self-confirm. */
  approve?: (call: ToolCall) => Promise<boolean>;
}

export type AgentEvent =
  | { type: 'plan'; text: string }
  | { type: 'tool-call'; tool: string; risk: string; args: unknown }
  | { type: 'confirm'; tool: string; risk: string; args: unknown }
  | { type: 'tool-result'; tool: string; ok: boolean; summary: string }
  | { type: 'denied'; tool: string; reason: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; taskId: string; answer: string }
  | { type: 'error'; message: string };

const StepDecision = z.object({
  action: z.enum(['call_tool', 'finish']),
  tool: z.string().optional(),
  args: z.record(z.any()).optional(),
  answer: z.string().optional(),
});

export interface AgentDeps {
  router: ModelRouter;
  tools: ToolRuntime;
  prompts: PromptRegistry;
  safety?: SafetyPolicy;
  alias?: ModelAlias;
  maxSteps?: number;
  idGen?: () => string;
}

/**
 * Multi-tool agent (S4-T3/T4). Plans, then loops: pick a tool (structured) → enforce Safety tiers
 * (read auto / low_write needs human confirm / high_write deny) → invoke → observe (results enter
 * ONLY the data channel) → repeat → finish. Tool risk comes from the tool declaration, never from
 * tool output, so a tool can't talk the agent into escalating (defense verified end-to-end).
 */
export class AgentOrchestrator {
  constructor(private readonly d: AgentDeps) {}

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const safety = this.d.safety ?? new SafetyPolicy();
    const approve = input.approve ?? (async () => false);
    const alias = this.d.alias ?? 'gpt_premium';
    const maxSteps = this.d.maxSteps ?? 8;
    const taskId = input.taskId ?? (this.d.idGen ?? randomUUID)();

    const evidence: UntrustedContent[] = [];
    const transcript: string[] = [];
    const toolMenu = this.d.tools
      .list()
      .map((t) => `- ${t.name} [${t.risk}]`)
      .join('\n');

    yield { type: 'plan', text: `Goal: ${input.goal}\nTools:\n${toolMenu || '(none)'}` };

    try {
      for (let step = 0; step < maxSteps; step++) {
        const system =
          this.d.prompts.render('agent.step').text +
          `\n\nAvailable tools:\n${toolMenu}\n\nActions so far:\n${transcript.join('\n') || '(none)'}`;
        const req = assembleRequest({ system, user: input.goal, data: evidence });
        const decision = await this.d.router.json(alias, req, StepDecision);

        if (decision.action === 'finish' || !decision.tool) {
          const answer = decision.answer ?? '';
          yield { type: 'delta', text: answer };
          yield { type: 'done', taskId, answer };
          return;
        }

        let risk: string;
        try {
          risk = this.d.tools.get(decision.tool).risk;
        } catch {
          transcript.push(`tool "${decision.tool}" not found`);
          continue;
        }
        const args = decision.args ?? {};
        yield { type: 'tool-call', tool: decision.tool, risk, args };

        const verdict = safety.decide(risk as never);
        if (verdict === 'deny') {
          yield { type: 'denied', tool: decision.tool, reason: 'high_write not allowed' };
          transcript.push(`DENIED ${decision.tool} (high_write)`);
          continue;
        }
        if (verdict === 'confirm') {
          yield { type: 'confirm', tool: decision.tool, risk, args };
          const ok = await approve({ tool: decision.tool, args, risk });
          if (!ok) {
            yield { type: 'denied', tool: decision.tool, reason: 'not confirmed' };
            transcript.push(`NOT CONFIRMED ${decision.tool}`);
            continue;
          }
        }

        const result = await this.d.tools.invoke(decision.tool, args, { taskId });
        const summary = result.ok
          ? result.data.map((dd) => dd.content).join('\n').slice(0, 300)
          : (result.error ?? 'error');
        yield { type: 'tool-result', tool: decision.tool, ok: result.ok, summary };
        for (const uc of result.data) evidence.push(uc);
        transcript.push(`${decision.tool}(${JSON.stringify(args)}) -> ${result.ok ? 'ok' : 'error'}`);
      }
      yield { type: 'error', message: 'max steps reached without finishing' };
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
}
