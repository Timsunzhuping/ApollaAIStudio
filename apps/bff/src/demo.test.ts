import { describe, it, expect } from 'vitest';
import type { TaskEvent } from '@apolla/harness-core';
import { buildHarness } from './harness';

const HAS_KEYS = !!(
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.TAVILY_API_KEY
);

// Deterministic only without provider keys (offline demo mode).
describe.skipIf(HAS_KEYS)('demo composition root (offline)', () => {
  it('runs research → cited report → cost end-to-end', async () => {
    const h = await buildHarness();
    expect(h.mode).toBe('demo');

    const events: TaskEvent[] = [];
    for await (const e of h.orchestrator.run({
      ownerId: 'u',
      question: 'state of the EV market in 2026',
      taskId: 'demo-1',
    })) {
      events.push(e);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('plan');
    expect(types).toContain('sources');
    expect(types).toContain('artifact');
    expect(types.at(-1)).toBe('done');

    const cost = events.find((e) => e.type === 'cost') as { totalUsd: number } | undefined;
    expect(cost?.totalUsd).toBeGreaterThan(0);

    const task = await h.repo.get('demo-1');
    expect(task?.state).toBe('done');
    expect(task?.citations.length).toBeGreaterThan(0);
    expect(task?.artifacts[0]?.content).toContain('## Sources');
    await h.close();
  });
});
