import type { Task } from '@apolla/contracts';

export interface CheckResult {
  name: string;
  ok: boolean;
  issues: string[];
}

/** ① Golden quality: the task completed with the expected structure. */
export function checkGoldenStructure(task: Task): CheckResult {
  const issues: string[] = [];
  if (task.state !== 'done') issues.push(`state is "${task.state}", expected "done"`);
  if (task.steps.length < 5) issues.push(`only ${task.steps.length} steps (expected ≥5)`);
  if (task.sources.length === 0) issues.push('no sources retrieved');
  const art = task.artifacts[0];
  if (!art) issues.push('no artifact produced');
  else {
    if (art.format !== 'markdown') issues.push(`artifact format "${art.format}", expected markdown`);
    if (!(art.content ?? '').includes('## Sources')) issues.push('artifact missing Sources section');
  }
  return { name: 'golden-structure', ok: issues.length === 0, issues };
}

/**
 * ② Citation correctness: every structured citation AND every inline [id] marker in the report
 * must reference a real retrieved source. This is what goes red if a citation is broken.
 */
export function checkCitationCorrectness(task: Task): CheckResult {
  const issues: string[] = [];
  const valid = new Set(task.sources.map((s) => s.id));

  for (const c of task.citations) {
    for (const id of c.sourceIds) {
      if (!valid.has(id)) issues.push(`citation references unknown source "${id}"`);
    }
  }

  const content = task.artifacts[0]?.content ?? '';
  for (const m of content.matchAll(/\[([a-z0-9]+:[0-9]+)\]/gi)) {
    const id = m[1]!;
    if (!valid.has(id)) issues.push(`report cites unknown source "${id}"`);
  }

  if (task.citations.length === 0) issues.push('no citations produced');
  return { name: 'citation-correctness', ok: issues.length === 0, issues };
}

/** ③ Cost regression: the task's metered cost must not exceed the baseline. */
export function checkCostRegression(totalUsd: number, baselineUsd: number): CheckResult {
  const ok = totalUsd <= baselineUsd;
  return {
    name: 'cost-regression',
    ok,
    issues: ok ? [] : [`cost $${totalUsd.toFixed(5)} exceeds baseline $${baselineUsd.toFixed(5)}`],
  };
}
