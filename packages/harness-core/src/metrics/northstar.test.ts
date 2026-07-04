import { describe, expect, it } from 'vitest';
import type { ProductEvent } from '@apolla/contracts';
import { effectiveWorkflows, weeklyNorthStar, weeklyReportMarkdown, WEEK_MS } from './northstar';

const W0 = Date.parse('2026-07-06T00:00:00.000Z'); // a Monday
const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();

let seq = 0;
const ev = (partial: Omit<ProductEvent, 'id' | 'at'> & { at: number }): ProductEvent => ({
  id: `e${++seq}`,
  ...partial,
  at: iso(partial.at),
});

const workflow = (ownerId: string, taskId: string, at: number, opts: { adopt?: boolean; unusable?: boolean } = {}) => {
  const events: ProductEvent[] = [
    ev({ type: 'task_submitted', ownerId, taskId, at }),
    ev({ type: 'task_delivered', ownerId, taskId, at: at + H }),
  ];
  if (opts.adopt !== false) events.push(ev({ type: 'artifact_adopted', ownerId, taskId, at: at + 2 * H, adoption: 'export' }));
  if (opts.unusable) events.push(ev({ type: 'feedback_given', ownerId, taskId, at: at + 3 * H, verdict: 'unusable' }));
  return events;
};

describe('effectiveWorkflows (三条件判定)', () => {
  it('delivered + adopted + no-unusable → effective', () => {
    expect(effectiveWorkflows(workflow('u1', 't1', W0)).get('t1')).toBe('u1');
  });
  it('delivered without adoption → not effective', () => {
    expect(effectiveWorkflows(workflow('u1', 't1', W0, { adopt: false })).size).toBe(0);
  });
  it('adopted but marked unusable → not effective', () => {
    expect(effectiveWorkflows(workflow('u1', 't1', W0, { unusable: true })).size).toBe(0);
  });
});

describe('weeklyNorthStar', () => {
  const events: ProductEvent[] = [
    ...workflow('u1', 'a1', W0 + 1 * H),
    ...workflow('u1', 'a2', W0 + 30 * H),
    ...workflow('u1', 'a3', W0 + 60 * H), // u1: 3 → at target
    ...workflow('u2', 'b1', W0 + 5 * H),
    ...workflow('u2', 'b2', W0 + 50 * H, { adopt: false }), // u2: 1 effective
    ev({ type: 'user_registered', ownerId: 'u3', at: W0 + 10 * H }),
    ...workflow('u3', 'c1', W0 + 11 * H), // activated within 24h
    ev({ type: 'user_registered', ownerId: 'u4', at: W0 + 20 * H }), // never activated
    ...workflow('u5', 'z1', W0 - 50 * H), // previous week — excluded
  ];
  const ns = weeklyNorthStar(events, new Date(W0));

  it('attributes workflows to the delivery week and computes per-user counts', () => {
    expect(ns.effectiveWorkflowsByOwner).toEqual({ u1: 3, u2: 1, u3: 1 });
    expect(ns.activeUsers).toBe(3);
    expect(ns.perActiveUser).toBeCloseTo(5 / 3);
    expect(ns.usersAtTarget).toBeCloseTo(1 / 3);
  });

  it('computes the funnel', () => {
    expect(ns.funnel.submitted).toBe(6);
    expect(ns.funnel.delivered).toBe(6);
    expect(ns.funnel.completionRate).toBe(1);
    expect(ns.funnel.adopted).toBe(5);
    expect(ns.funnel.adoptionRate).toBeCloseTo(5 / 6);
  });

  it('computes activation (first artifact within 24h of signup)', () => {
    expect(ns.activation).toEqual({ registered: 2, activated: 1, rate: 0.5 });
  });

  it('counts adoption landing within the 48h grace window after week end', () => {
    const late: ProductEvent[] = [
      ev({ type: 'task_submitted', ownerId: 'u9', taskId: 'l1', at: W0 + WEEK_MS - 2 * H }),
      ev({ type: 'task_delivered', ownerId: 'u9', taskId: 'l1', at: W0 + WEEK_MS - 1 * H }),
      ev({ type: 'artifact_adopted', ownerId: 'u9', taskId: 'l1', at: W0 + WEEK_MS + 10 * H, adoption: 'share' }),
    ];
    expect(weeklyNorthStar(late, new Date(W0)).effectiveWorkflowsByOwner['u9']).toBe(1);
  });
});

describe('weeklyReportMarkdown', () => {
  it('renders metrics with targets and the below-target rule', () => {
    const ns = weeklyNorthStar(
      [...workflow('u1', 't1', W0), ev({ type: 'user_registered', ownerId: 'u2', at: W0 })],
      new Date(W0),
    );
    const md = weeklyReportMarkdown(ns);
    expect(md).toContain('Effective workflows / active user: 1.00');
    expect(md).toContain('target ≥ 3');
    expect(md).toContain('root-cause analysis');
  });
});
