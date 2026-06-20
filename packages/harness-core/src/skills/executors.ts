import { randomUUID } from 'node:crypto';
import type { ModelAlias, UntrustedContent, Source } from '@apolla/contracts';
import type { ModelRouter } from '../router/router';
import type { PromptRegistry } from '../prompts/registry';
import type { ToolRuntime } from '../tools/runtime';
import { assembleRequest } from '../safety/untrusted';
import type { ResearchOrchestrator } from '../orchestrator/research';
import type { SkillExecutor } from './types';

/** Research skills delegate to the full orchestrator state machine. */
export function makeResearchExecutor(orchestrator: ResearchOrchestrator): SkillExecutor {
  return (_skill, input) =>
    orchestrator.run({
      ownerId: input.ownerId,
      question: input.question,
      taskId: input.taskId,
      projectId: input.projectId,
    });
}

export interface GenericExecutorDeps {
  router: ModelRouter;
  prompts: PromptRegistry;
  tools?: ToolRuntime;
  alias?: ModelAlias;
}

/**
 * Generic single-shot executor: optionally gather web evidence, then stream a model response
 * from the skill's prompt. Powers simple declarative skills (e.g. summarize) with no bespoke code.
 */
export function makeGenericExecutor(deps: GenericExecutorDeps): SkillExecutor {
  const alias = deps.alias ?? 'claude_write';
  return async function* (skill, input) {
    const stepId = randomUUID();
    yield { type: 'step-start', state: 'generate', stepId };

    let data: UntrustedContent[] = [];
    if (deps.tools && skill.tools.includes('web_search') && deps.tools.has('web_search')) {
      const result = await deps.tools.invoke<{ query: string }>('web_search', { query: input.question });
      data = result.data;
      if (data.length) {
        const sources: Source[] = data.map((d) => ({
          id: d.sourceId,
          url: d.origin,
          title: d.content.split('\n')[0] ?? d.sourceId,
          trusted: false,
        }));
        yield { type: 'sources', sources };
      }
    }

    const system = deps.prompts.get(skill.promptRef).template;
    const req = assembleRequest({ system, user: input.question, data });
    for await (const chunk of deps.router.complete(alias, req)) {
      if (chunk.delta) yield { type: 'delta', text: chunk.delta };
    }

    yield { type: 'step-end', state: 'generate', stepId };
    yield { type: 'done', taskId: input.taskId ?? stepId };
  };
}
