import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ModelAlias } from '@apolla/contracts';
import type { ModelRouter } from '../router/router';
import type { PromptRegistry } from '../prompts/registry';
import { assembleRequest } from '../safety/untrusted';
import type { ToolCall } from '../agent/orchestrator';
import { Coordinator, type CoworkEvent } from './coordinator';

const PlanSchema = z.object({ subgoals: z.array(z.string()).default([]) });

export interface CoworkDeps {
  coordinator: Coordinator;
  router: ModelRouter;
  prompts: PromptRegistry;
  alias?: ModelAlias;
  /** Cap on planned sub-goals before the coordinator's own fan-out guard (default 5). */
  maxSubAgents?: number;
}

export interface CoworkInput {
  ownerId: string;
  goal: string;
  taskId?: string;
  /** Explicit sub-goals; if omitted the orchestrator plans them from the goal. */
  subgoals?: string[];
  approve?: (call: ToolCall) => Promise<boolean>;
  clarify?: (question: string) => Promise<string | null>;
  /** Persist sections + brief to the workspace (S7-T4); `enabled` should mirror fs_write authorization. */
  files?: { enabled: boolean; basePath: string; projectId?: string };
}

/**
 * Cowork orchestrator (S6-T4, PRD §15). The integrative mode: plan a goal into sub-goals (LLM,
 * structured), fan out to bounded sub-agents via the Coordinator, synthesize one deliverable.
 * Runs as a Job (foreground SSE, or background/scheduled via Sprint 05's JobRunner/Scheduler).
 */
export class CoworkOrchestrator {
  constructor(private readonly d: CoworkDeps) {}

  async *run(input: CoworkInput): AsyncIterable<CoworkEvent> {
    const taskId = input.taskId ?? randomUUID();
    let subgoals = input.subgoals?.filter((s) => s.trim().length > 0) ?? [];
    if (subgoals.length === 0) {
      const alias = this.d.alias ?? 'gpt_premium';
      const system = this.d.prompts.render('cowork.plan').text;
      const plan = await this.d.router.json(alias, assembleRequest({ system, user: input.goal, data: [] }), PlanSchema);
      subgoals = (plan.subgoals ?? []).filter((s) => s.trim().length > 0);
    }
    if (this.d.maxSubAgents) subgoals = subgoals.slice(0, this.d.maxSubAgents);
    yield* this.d.coordinator.run({ ...input, taskId, subgoals });
  }
}
