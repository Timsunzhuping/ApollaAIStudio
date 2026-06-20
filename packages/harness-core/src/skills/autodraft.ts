import { SkillDef, type Task, type SkillDef as SkillDefT } from '@apolla/contracts';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || 'topic';
}

/**
 * Closed learning loop (PRD §12.A): after a high-quality research task, draft a reusable Skill.
 * Returns null if the task isn't a completed research task. The user reviews before saving.
 */
export function autoDraftSkill(task: Task): SkillDefT | null {
  if (task.type !== 'research' || task.state !== 'done') return null;
  const question = task.question ?? 'topic';
  const tools = task.steps.some((s) => s.state === 'search') ? ['web_search'] : [];
  return SkillDef.parse({
    name: `research-${slug(question)}`,
    triggers: [question.toLowerCase().split(/\s+/).slice(0, 4).join(' ')],
    tools,
    risk: 'read',
    promptRef: 'research.synthesize',
    executor: 'research',
  });
}
