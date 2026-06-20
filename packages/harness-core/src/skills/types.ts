import type { SkillDef } from '@apolla/contracts';
import type { TaskEvent } from '../orchestrator/events';

export interface SkillRunInput {
  ownerId: string;
  question: string;
  taskId?: string;
  projectId?: string;
}

/** Runs a skill, emitting the same TaskEvent stream the orchestrator does. */
export type SkillExecutor = (skill: SkillDef, input: SkillRunInput) => AsyncIterable<TaskEvent>;

/** Where skills come from: config (built-in) + a user's saved skills. */
export interface SkillSource {
  list(ownerId?: string): Promise<SkillDef[]>;
}

/** Persistent store for user-authored / auto-drafted skills (PRD §12.A). */
export interface SkillRepository {
  save(ownerId: string, def: SkillDef): Promise<SkillDef>;
  list(ownerId: string): Promise<SkillDef[]>;
  delete(ownerId: string, name: string): Promise<void>;
}
