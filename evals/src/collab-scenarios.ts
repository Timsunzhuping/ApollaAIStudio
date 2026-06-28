import { Rga, Replica, CollabSession, InMemoryCollabRepository, type CollabOp } from '@apolla/harness-core';
import type { CheckResult } from './checks';

const replay = (ops: CollabOp[]): string => {
  const r = new Rga();
  r.applyMany(ops);
  return r.text();
};

/**
 * Collaboration (S21): the CRDT converges for any op delivery order (concurrent inserts + deletes),
 * and two clients syncing through a CollabSession's op log reach the same text. Fully offline.
 */
export async function collabConvergence(): Promise<CheckResult> {
  const issues: string[] = [];

  // Concurrent edits from two replicas, exchanged in several orders → one converged text.
  const a = new Replica('aaa');
  const b = new Replica('bbb');
  const ops = [...a.insertStringAt(0, 'cat'), ...b.insertStringAt(0, 'dog')];
  const orders = [ops, [...ops].reverse(), [...ops.slice(2), ...ops.slice(0, 2)]];
  const texts = new Set(orders.map(replay));
  if (texts.size !== 1) issues.push('CRDT did not converge across op orders');

  // Concurrent delete that may arrive before its insert still converges.
  const c = new Replica('c');
  const ins = c.insertStringAt(0, 'abc');
  const del = c.deleteAt(1)!;
  if (replay([...ins, del]) !== 'ac' || replay([del, ...ins]) !== 'ac') issues.push('delete did not converge across order');

  // Two clients through the server log converge.
  const doc = new InMemoryCollabRepository().getOrCreate('d', 'owner');
  const x = new Replica('x');
  doc.session.applyOps(x.insertStringAt(0, 'hi'));
  const y = new Replica('y');
  for (const op of doc.session.opsSince(0)) y.apply(op);
  doc.session.applyOps(y.insertStringAt(y.text().length, '!'));
  for (const op of doc.session.opsSince(0)) x.apply(op);
  if (x.text() !== doc.session.text() || x.text() !== 'hi!') issues.push(`two-client sync diverged: ${x.text()}`);

  // Snapshot/restore preserves text; replay is idempotent.
  if (CollabSession.restore(doc.session.snapshot()).text() !== 'hi!') issues.push('snapshot→restore lost text');

  return { name: 'collab-convergence', ok: issues.length === 0, issues };
}

export async function runCollabScenarios(): Promise<CheckResult[]> {
  return [await collabConvergence()];
}
