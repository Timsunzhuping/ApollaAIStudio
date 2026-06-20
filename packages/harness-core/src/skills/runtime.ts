import type { SkillDef } from '@apolla/contracts';
import type { TaskEvent } from '../orchestrator/events';
import type { SkillExecutor, SkillRunInput, SkillSource } from './types';

/**
 * Skill Runtime (PRD §12.A). Loads declarative skills (config + user), matches by trigger,
 * and dispatches execution to a registered executor keyed by `skill.executor` (falling back to
 * a generic single-shot executor). Adding a declarative skill needs no business-code change.
 */
export class SkillRuntime {
  private readonly executors = new Map<string, SkillExecutor>();

  constructor(
    private readonly source: SkillSource,
    private readonly fallback: SkillExecutor,
  ) {}

  registerExecutor(key: string, executor: SkillExecutor): void {
    this.executors.set(key, executor);
  }

  list(ownerId?: string): Promise<SkillDef[]> {
    return Promise.resolve(this.source.list(ownerId));
  }

  async match(query: string, ownerId?: string): Promise<SkillDef[]> {
    const q = query.toLowerCase();
    return (await this.list(ownerId)).filter(
      (s) => q.includes(s.name.toLowerCase()) || s.triggers.some((t) => q.includes(t.toLowerCase())),
    );
  }

  async get(name: string, ownerId?: string): Promise<SkillDef | undefined> {
    return (await this.list(ownerId)).find((s) => s.name === name);
  }

  run(skill: SkillDef, input: SkillRunInput): AsyncIterable<TaskEvent> {
    const executor = this.executors.get(skill.executor ?? '') ?? this.fallback;
    return executor(skill, input);
  }
}
