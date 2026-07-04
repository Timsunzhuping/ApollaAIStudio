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
import { currentSpanContext } from '../obs/context';
import type { TaskRepository } from '../repo/types';
import type { Memory } from '../memory/types';
import { userModelDirective } from '../memory/types';
import type { TaskEvent } from './events';
import { fetchEnrichEvidence } from './fetch-enrich';
import {
  SnippetsResult,
  ClaimsCompareResult,
  validateSnippets,
  validateClaims,
  pageKey,
} from './verify';
import type { Snippet } from '@apolla/contracts';

const PlanResult = z.object({
  subquestions: z.array(z.string()).min(1),
  estimateSeconds: z.number().int().positive().optional(),
});

const ClaimsResult = z.object({
  claims: z.array(z.object({ claim: z.string(), sourceIds: z.array(z.string()) })).default([]),
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
      snippets: [],
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
      const span1 = this.tracer.startSpan('plan', { parent: currentSpanContext() });
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
      // Sources for display/citation are the search hits (one per origin) — captured before
      // fetch enrichment so the list stays clean instead of one entry per fetched paragraph.
      const searchEvidence = [...evidence];
      // S25: fetch the top-N pages for their real article text; degrade gracefully to the
      // search snippet when `web_fetch` is absent or a page can't be fetched (never blocks).
      const enrich = await fetchEnrichEvidence(this.d.tools, searchEvidence, { taskId });
      const degraded = new Set(enrich.degradedOrigins);
      for (const uc of enrich.evidence) {
        if (seen.has(uc.sourceId)) continue;
        seen.add(uc.sourceId);
        evidence.push(uc);
      }
      task.sources = searchEvidence.map((uc) => {
        const s = toSource(uc);
        return uc.origin && degraded.has(uc.origin) ? { ...s, degraded: true } : s;
      });
      step.summary = enrich.fetched > 0
        ? `${task.sources.length} sources · ${enrich.fetched} fetched`
        : `${task.sources.length} sources`;
      yield { type: 'sources', sources: task.sources };
      yield { type: 'step-end', state: 'search', stepId: step.id, summary: step.summary };

      // The verified pipeline (S25: extract quotes → compare claims → cited synthesis) engages
      // only when real page text was fetched AND its prompts are registered; otherwise the run
      // takes the legacy path unchanged — fail-safe by construction.
      // File-derived chunks (workspace retrieval, S27) are verifiable evidence too.
      const fileChunks = effectiveExtra.filter((uc) => uc.sourceId.startsWith('file:'));
      const verifiedPath =
        (enrich.fetched > 0 || fileChunks.length > 0) &&
        this.d.prompts.has('research.extract') &&
        this.d.prompts.has('research.compare');
      // Map a fetched chunk id back to its display source (citations must reference task.sources).
      const sourceIdByOrigin = new Map(searchEvidence.map((uc) => [uc.origin, uc.sourceId]));
      const originByPage = enrich.requestedOriginByPage;
      const knownSourceIds = new Set(searchEvidence.map((uc) => uc.sourceId));
      const displaySourceIdForChunk = (chunkId: string): string | undefined => {
        if (chunkId.startsWith('file:')) return knownSourceIds.has(chunkId) ? chunkId : undefined;
        const origin = originByPage[pageKey(chunkId)];
        return origin ? sourceIdByOrigin.get(origin) : undefined;
      };

      // 3) EXTRACT — select verbatim quotes per subquestion, then programmatically verify each
      // quote is a real substring of its chunk (fabricated quotes are dropped, never repaired).
      step = begin('extract');
      yield { type: 'step-start', state: 'extract', stepId: step.id };
      const fetchedChunks = [...enrich.evidence, ...fileChunks];
      let rejectedQuotes = 0;
      if (verifiedPath) {
        const span3 = this.tracer.startSpan('extract', { parent: currentSpanContext() });
        const seenQuotes = new Set<string>();
        for (const sq of plan.subquestions) {
          const req = assembleRequest({
            system: this.d.prompts.render('research.extract').text,
            user: sq,
            data: fetchedChunks,
          });
          const raw = await router.json(this.planAlias, req, SnippetsResult);
          const { snippets, rejected } = validateSnippets(raw, fetchedChunks, this.idGen);
          rejectedQuotes += rejected;
          for (const s of snippets) {
            const key = `${s.sourceId} ${s.quote}`;
            if (seenQuotes.has(key)) continue;
            seenQuotes.add(key);
            task.snippets.push(s);
          }
        }
        span3.end();
        step.summary = `${task.snippets.length} verified quotes` + (rejectedQuotes ? ` · ${rejectedQuotes} rejected` : '');
        yield { type: 'snippets', snippets: task.snippets };
      } else {
        step.summary = `${evidence.length} evidence chunks`;
      }
      yield { type: 'step-end', state: 'extract', stepId: step.id, summary: step.summary };

      // 3b) COMPARE — derive cross-source claims over the verified quotes; claim status is
      // recomputed from evidence (conflict → disputed; 2+ pages → corroborated).
      const snippetData: UntrustedContent[] = task.snippets.map((s) => ({
        kind: 'untrusted' as const,
        sourceId: s.id,
        origin: s.sourceId,
        content: s.quote,
      }));
      if (verifiedPath && task.snippets.length > 0) {
        step = begin('compare');
        const spanC = this.tracer.startSpan('compare', { parent: currentSpanContext() });
        yield { type: 'step-start', state: 'compare', stepId: step.id };
        const compareReq = assembleRequest({
          system: this.d.prompts.render('research.compare').text,
          user: input.question,
          data: snippetData,
        });
        const rawClaims = await router.json(this.planAlias, compareReq, ClaimsCompareResult);
        task.citations = validateClaims(rawClaims, task.snippets, displaySourceIdForChunk);
        spanC.end();
        yield { type: 'citations', citations: task.citations };
        yield { type: 'step-end', state: 'compare', stepId: step.id, summary: `${task.citations.length} compared claims` };
      }

      // 4) GENERATE — stream the prose report. On the verified path the model writes from the
      // verified quotes and cites them as [^snippetId]; legacy runs keep two-phase citation
      // extraction (S2-T9) so behavior is unchanged where S25 isn't active.
      step = begin('generate');
      const span4 = this.tracer.startSpan('generate', { parent: currentSpanContext() });
      yield { type: 'step-start', state: 'generate', stepId: step.id };
      const useCited = verifiedPath && task.snippets.length > 0 && this.d.prompts.has('research.synthesize-cited');
      const proseReq = assembleRequest({
        system: sys(this.d.prompts.render(useCited ? 'research.synthesize-cited' : 'research.synthesize').text),
        user: input.question,
        data: useCited ? snippetData : evidence,
      });
      let report = '';
      for await (const chunk of router.complete(this.synthAlias, proseReq)) {
        report += chunk.delta;
        if (chunk.delta) yield { type: 'delta', text: chunk.delta };
      }
      if (task.citations.length === 0) {
        const extractReq = assembleRequest({
          system: this.d.prompts.render('research.extract-citations').text,
          user: report,
          data: evidence,
        });
        const extracted = await router.json(this.synthAlias, extractReq, ClaimsResult);
        const validIds = new Set(task.sources.map((s) => s.id));
        // Citation integrity: keep only claims backed by a known source (ARCHITECTURE §3.9 / PRD §6.2).
        task.citations = (extracted.claims ?? [])
          .map((c) => ({ claim: c.claim, sourceIds: c.sourceIds.filter((id) => validIds.has(id)) }))
          .filter((c): c is Citation => c.sourceIds.length > 0);
        yield { type: 'citations', citations: task.citations };
      }
      span4.end();
      yield { type: 'step-end', state: 'generate', stepId: step.id, summary: `${task.citations.length} cited claims` };

      // 5) DELIVER (assemble the report artifact — footnoted when verified quotes exist)
      step = begin('deliver');
      yield { type: 'step-start', state: 'deliver', stepId: step.id };
      const artifact = buildReport(input.question, report, task.sources, task.snippets, task.citations);
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
          content: `Researched "${input.question}": ${report.slice(0, 240)}`,
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

function buildReport(
  question: string,
  report: string,
  sources: Source[],
  snippets: Snippet[] = [],
  citations: Citation[] = [],
): Artifact {
  const list = sources
    .map((s) => `- [${s.id}] ${s.title ?? ''} — ${s.url ?? ''}${s.degraded ? ' _(snippet only — page fetch failed)_' : ''}`)
    .join('\n');
  const sections = [`# ${question}`, '', report];

  // Verified path (S25): compared claims + verbatim quote footnotes make every conclusion traceable.
  const compared = citations.filter((c) => c.status);
  if (compared.length > 0) {
    const label = { corroborated: 'Corroborated', single_source: 'Single source', disputed: 'Disputed' } as const;
    sections.push(
      '',
      '## Key claims',
      '',
      ...compared.map(
        (c) => `- **[${label[c.status!]}]** ${c.claim} (${(c.snippetIds ?? []).map((id) => `[^${id}]`).join(' ')})`,
      ),
    );
  }
  if (snippets.length > 0) {
    sections.push('', '## Cited snippets', '', ...snippets.map((s) => `[^${s.id}]: "${s.quote}" — ${s.sourceId}`));
  }
  sections.push('', '## Sources', '', list, '');
  const content = sections.join('\n');
  return { id: `artifact-${question.length}-${sources.length}`, type: 'report', format: 'markdown', content };
}
