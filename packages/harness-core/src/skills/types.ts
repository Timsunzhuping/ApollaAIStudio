import type { SkillDef } from '@apolla/contracts';
import type { TaskEvent } from '../orchestrator/events';
import type { MediaEvent } from '../media/orchestrator';

export interface SkillRunInput {
  ownerId: string;
  question: string;
  taskId?: string;
  projectId?: string;
}

/** A skill run emits research TaskEvents or media MediaEvents depending on the executor. */
export type SkillEvent = TaskEvent | MediaEvent;

/** Runs a skill, emitting an event stream (research or media). */
export type SkillExecutor = (skill: SkillDef, input: SkillRunInput) => AsyncIterable<SkillEvent>;

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
