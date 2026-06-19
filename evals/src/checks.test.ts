import { describe, it, expect } from 'vitest';
import type { Task } from '@apolla/contracts';
import { runGolden } from './golden';
import { checkGoldenStructure, checkCitationCorrectness, checkCostRegression } from './checks';

describe('research golden', () => {
  it('passes all three checks deterministically', async () => {
    const { task, totalUsd } = await runGolden();
    expect(checkGoldenStructure(task).ok).toBe(true);
    expect(checkCitationCorrectness(task).ok).toBe(true);
    expect(checkCostRegression(totalUsd, 0.001).ok).toBe(true);
  });
});

describe('checks go red when they should (negative controls)', () => {
  it('citation-correctness fails when the report cites an unknown source', async () => {
    const { task } = await runGolden();
    const broken: Task = {
      ...task,
      artifacts: [{ ...task.artifacts[0]!, content: 'Claim with a bad cite [ghost:9].' }],
    };
    const r = checkCitationCorrectness(broken);
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toContain('ghost:9');
  });

  it('cost-regression fails when cost exceeds the baseline', () => {
    expect(checkCostRegression(0.05, 0.001).ok).toBe(false);
  });

  it('golden-structure fails on an unfinished task', async () => {
    const { task } = await runGolden();
    expect(checkGoldenStructure({ ...task, state: 'generate' }).ok).toBe(false);
  });
});
