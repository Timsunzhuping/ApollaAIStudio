import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  ModelAlias,
  RouteConfig,
  Task,
  Step,
  Source,
  Citation,
  Artifact,
  UntrustedContent,
} from '@apolla/contracts';
import { getRoute } from '@apolla/config';
import { ModelRouter } from '../router/router';
import type { LLMAdapter } from '../router/types';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { InMemoryCostLedger } from '../cost/ledger';
import { assembleRequest } from '../safety/untrusted';
import { NoopTracer, type Tracer } from '../obs/tracer';
import type { TaskRepository } from '../repo/types';
import type { Memory } from '../memory/types';
import { userModelDirective } from '../memory/types';
import type { TaskEvent } from './events';

const PlanResult = z.object({
  subquestions: z.array(z.string()).min(1),
  estimateSeconds: z.number().int().positive().optional(),
});

const SynthResult = z.object({
  report: z.string().min(1),
  claims: z
    .array(z.object({ claim: z.string(), sourceIds: z.array(z.string()) }))
    .default([]),
});

export interface ResearchDeps {
  adapters: Map<string, LLMAdapter>;
  prompts: PromptRegistry;
  /** Must have a registered 'web_search' tool. */
  tools: ToolRuntime;
  ledger: InMemoryCostLedger;
  repo: TaskRepository;
  /** Optional persistent memory — when present, recalled + user-model context personalizes the run. */
  memory?: Memory;
  routeFor?: (alias: ModelAlias) => RouteConfig;
  env?: NodeJS.ProcessEnv;
  tracer?: Tracer;
  planAlias?: ModelAlias;
  synthAlias?: ModelAlias;
  /** Injectable id generator for deterministic tests. */
  idGen?: () => string;
}

export interface RunInput {
  ownerId: string;
  question: string;
  taskId?: string;
  projectId?: string;
  /** Trusted context appended to plan/synthesis system prompts (e.g. project background, user model). */
  systemAddendum?: string;
  /** Untrusted evidence injected via the data channel (e.g. project materials, recalled memory). */
  extraEvidence?: UntrustedContent[];
}

/**
 * Research orchestrator (ARCHITECTURE §3.9). Drives the state machine
 * plan → search → extract → generate → deliver → done, emitting a TaskEvent stream and
 * persisting a replayable Task. Untrusted evidence flows only through the data channel;
 * every LLM call is metered into the Cost Ledger per step.
 */
export class ResearchOrchestrator {
  private readonly d: ResearchDeps;
  private readonly planAlias: ModelAlias;
  private readonly synthAlias: ModelAlias;
  private readonly idGen: () => string;
  private readonly tracer: Tracer;

  constructor(deps: ResearchDeps) {
    this.d = deps;
    this.planAlias = deps.planAlias ?? 'gpt_premium';
    this.synthAlias = deps.synthAlias ?? 'claude_write';
    this.idGen = deps.idGen ?? (() => randomUUID());
    this.tracer = deps.tracer ?? new NoopTracer();
  }

  async *run(input: RunInput): AsyncIterable<TaskEvent> {
    const taskId = input.taskId ?? this.idGen();
    const ctx: { stepId?: string } = {};

    const router = new ModelRouter({
      adapters: this.d.adapters,
      routeFor: this.d.routeFor ?? getRoute,
      env: this.d.env,
      onUsage: (e) => this.d.ledger.recordLLM(e, { taskId, stepId: ctx.stepId }),
    });

    // Personalization: recalled memory (untrusted → data channel) + user model (trusted → system).
    let memEvidence: UntrustedContent[] = [];
    const addenda: string[] = [];
    if (input.systemAddendum) addenda.push(input.systemAddendum);
    if (this.d.memory) {
      const model = await this.d.memory.getUserModel(input.ownerId);
      const directive = userModelDirective(model);
      if (directive) addenda.push(directive);
      const recalled = await this.d.memory.recall(input.ownerId, input.question);
      memEvidence = recalled.map((m) => ({
        kind: 'untrusted' as const,
        sourceId: `mem:${m.id}`,
        origin: 'memory',
        content: m.content,
      }));
    }
    const effectiveAddendum = addenda.join('\n\n') || undefined;
    const effectiveExtra = [...(input.extraEvidence ?? []), ...memEvidence];

    const sys = (base: string) => (effectiveAddendum ? `${base}\n\n${effectiveAddendum}` : base);

    const task: Task = {
      id: taskId,
      type: 'research',
      state: 'plan',
      ownerId: input.ownerId,
      projectId: input.projectId,
      question: input.question,
      steps: [],
      sources: [],
      citations: [],
      artifacts: [],
      totalCostUsd: 0,
      replayable: true,
    };
    await this.d.repo.create(task);

    const begin = (state: Task['state']): Step => {
      const step: Step = { id: this.idGen(), state, costUsd: 0 };
      ctx.stepId = step.id;
      task.state = state;
      task.steps.push(step);
      return step;
    };

    try {
      // 1) PLAN
      let step = begin('plan');
      const span1 = this.tracer.startSpan('plan');
      yield { type: 'step-start', state: 'plan', stepId: step.id };
      const planReq = assembleRequest({
        system: sys(this.d.prompts.render('research.plan').text),
        user: input.question,
      });
      const plan = await router.json(this.planAlias, planReq, PlanResult);
      const estimate = { seconds: plan.estimateSeconds ?? plan.subquestions.length * 30 };
      step.summary = `${plan.subquestions.length} subquestions`;
      span1.end();
      yield { type: 'plan', plan: { subquestions: plan.subquestions }, estimate };
      yield { type: 'step-end', state: 'plan', stepId: step.id, summary: step.summary };

      // 2) SEARCH
      step = begin('search');
      yield { type: 'step-start', state: 'search', stepId: step.id };
      const evidence: UntrustedContent[] = [];
      const seen = new Set<string>();
      for (const uc of effectiveExtra) {
        if (seen.has(uc.sourceId)) continue;
        seen.add(uc.sourceId);
        evidence.push(uc);
      }
      for (const q of plan.subquestions) {
        const result = await this.d.tools.invoke<{ query: string }>('web_search', { query: q }, {
          taskId,
        });
        for (const uc of result.data) {
          if (seen.has(uc.sourceId)) continue;
          seen.add(uc.sourceId);
          evidence.push(uc);
        }
      }
      task.sources = evidence.map((uc) => toSource(uc));
      step.summary = `${task.sources.length} sources`;
      yield { type: 'sources', sources: task.sources };
      yield { type: 'step-end', state: 'search', stepId: step.id, summary: step.summary };

      // 3) EXTRACT (evidence prepared; dedupe already done)
      step = begin('extract');
      yield { type: 'step-start', state: 'extract', stepId: step.id };
      step.summary = `${evidence.length} evidence chunks`;
      yield { type: 'step-end', state: 'extract', stepId: step.id, summary: step.summary };

      // 4) GENERATE (cited synthesis)
      step = begin('generate');
      const span4 = this.tracer.startSpan('generate');
      yield { type: 'step-start', state: 'generate', stepId: step.id };
      const synthReq = assembleRequest({
        system: sys(this.d.prompts.render('research.synthesize').text),
        user: input.question,
        data: evidence,
      });
      const synth = await router.json(this.synthAlias, synthReq, SynthResult);
      const validIds = new Set(task.sources.map((s) => s.id));
      // Citation integrity: keep only claims backed by a known source (ARCHITECTURE §3.9 / PRD §6.2).
      task.citations = (synth.claims ?? [])
        .map((c) => ({ claim: c.claim, sourceIds: c.sourceIds.filter((id) => validIds.has(id)) }))
        .filter((c): c is Citation => c.sourceIds.length > 0);
      span4.end();
      yield { type: 'delta', text: synth.report };
      yield { type: 'citations', citations: task.citations };
      yield { type: 'step-end', state: 'generate', stepId: step.id, summary: `${task.citations.length} cited claims` };

      // 5) DELIVER (assemble the report artifact)
      step = begin('deliver');
      yield { type: 'step-start', state: 'deliver', stepId: step.id };
      const artifact = buildReport(input.question, synth.report, task.sources);
      task.artifacts = [artifact];
      yield { type: 'artifact', artifact };
      yield { type: 'step-end', state: 'deliver', stepId: step.id };

      // DONE
      task.state = 'done';
      task.totalCostUsd = this.d.ledger.totalUsd(taskId);
      await this.d.repo.save(task);
      if (this.d.memory) {
        await this.d.memory.note({
          ownerId: input.ownerId,
          content: `Researched "${input.question}": ${synth.report.slice(0, 240)}`,
        });
      }
      yield { type: 'cost', totalUsd: task.totalCostUsd };
      yield { type: 'done', taskId };
    } catch (e) {
      task.state = 'failed';
      await this.d.repo.save(task);
      yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
}

function toSource(uc: UntrustedContent): Source {
  const [title, ...rest] = uc.content.split('\n');
  return {
    id: uc.sourceId,
    url: uc.origin,
    title: title ?? uc.sourceId,
    snippet: rest.join('\n'),
    trusted: false,
  };
}

function buildReport(question: string, report: string, sources: Source[]): Artifact {
  const list = sources.map((s) => `- [${s.id}] ${s.title ?? ''} — ${s.url ?? ''}`).join('\n');
  const content = `# ${question}\n\n${report}\n\n## Sources\n\n${list}\n`;
  return { id: `artifact-${question.length}-${sources.length}`, type: 'report', format: 'markdown', content };
}
