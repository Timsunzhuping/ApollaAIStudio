/**
 * S25-T5 — Live research-quality gate (`pnpm eval:live`).
 *
 * Runs the REAL pipeline (real LLM keys + Tavily search + HTTP fetch) over 10 golden
 * questions and measures what the offline evals cannot: citation coverage on real model
 * output, claim-status distribution, fetch degradation, cost, and latency.
 *
 * Quote correctness is enforced in-pipeline (validateSnippets drops any non-verbatim
 * quote), so this gate focuses on coverage + cost. Thresholds per docs/SPRINT_25 DoD.
 *
 * Requires OPENAI_API_KEY + ANTHROPIC_API_KEY + TAVILY_API_KEY; exits 0 with a notice
 * otherwise so CI stays hermetic (run it manually or in a keyed environment).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const THRESHOLDS = {
  citedParagraphRatio: 0.8,
  maxAvgDegradedRatio: 0.5,
  maxCostPerQuestionUsd: 0.6,
};

interface QuestionScore {
  id: string;
  citedParagraphRatio: number;
  snippets: number;
  claims: Record<string, number>;
  degradedRatio: number;
  costUsd: number;
  seconds: number;
  error?: string;
}

const need = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TAVILY_API_KEY'].filter((k) => !process.env[k]);
if (need.length > 0) {
  console.log(`eval:live skipped — missing ${need.join(', ')} (run in a keyed environment).`);
  process.exit(0);
}
process.env.FETCH_MODE = process.env.FETCH_MODE || 'http';

const { buildHarness } = await import('@apolla/bff/harness');
const h = await buildHarness();

const golden: { id: string; question: string }[] = JSON.parse(
  readFileSync(join(HERE, 'golden-live.json'), 'utf8'),
);

const scores: QuestionScore[] = [];
for (const g of golden) {
  const t0 = Date.now();
  try {
    let report = '';
    let snippets = 0;
    let degraded = 0;
    let sources = 0;
    const claims: Record<string, number> = {};
    let costUsd = 0;
    for await (const ev of h.orchestrator.run({ ownerId: 'live-eval', question: g.question })) {
      if (ev.type === 'delta') report += ev.text;
      else if (ev.type === 'snippets') snippets = ev.snippets.length;
      else if (ev.type === 'sources') {
        sources = ev.sources.length;
        degraded = ev.sources.filter((s) => s.degraded).length;
      } else if (ev.type === 'citations') {
        for (const c of ev.citations) if (c.status) claims[c.status] = (claims[c.status] ?? 0) + 1;
      } else if (ev.type === 'cost') costUsd = ev.totalUsd;
      else if (ev.type === 'error') throw new Error(ev.message);
    }
    const paras = report.split(/\n{2,}/).filter((p) => p.trim().length >= 40 && !/^#{1,6}\s/.test(p.trim()));
    const cited = paras.filter((p) => /\[\^[\w:-]+\]/.test(p));
    scores.push({
      id: g.id,
      citedParagraphRatio: paras.length ? cited.length / paras.length : 0,
      snippets,
      claims,
      degradedRatio: sources ? degraded / sources : 0,
      costUsd,
      seconds: (Date.now() - t0) / 1000,
    });
    console.log(`  ${g.id}: coverage ${(scores.at(-1)!.citedParagraphRatio * 100).toFixed(0)}% · ${snippets} quotes · $${costUsd.toFixed(3)} · ${scores.at(-1)!.seconds.toFixed(0)}s`);
  } catch (e) {
    scores.push({
      id: g.id, citedParagraphRatio: 0, snippets: 0, claims: {}, degradedRatio: 1,
      costUsd: 0, seconds: (Date.now() - t0) / 1000, error: e instanceof Error ? e.message : String(e),
    });
    console.log(`  ${g.id}: ERROR ${scores.at(-1)!.error}`);
  }
}

const avg = (f: (s: QuestionScore) => number) => scores.reduce((n, s) => n + f(s), 0) / Math.max(1, scores.length);
const summary = {
  thresholds: THRESHOLDS,
  averages: {
    citedParagraphRatio: avg((s) => s.citedParagraphRatio),
    degradedRatio: avg((s) => s.degradedRatio),
    costUsd: avg((s) => s.costUsd),
    seconds: avg((s) => s.seconds),
  },
  pass:
    avg((s) => s.citedParagraphRatio) >= THRESHOLDS.citedParagraphRatio &&
    avg((s) => s.degradedRatio) <= THRESHOLDS.maxAvgDegradedRatio &&
    scores.every((s) => s.costUsd <= THRESHOLDS.maxCostPerQuestionUsd && !s.error),
  scores,
};

const outDir = join(HERE, 'reports');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
writeFileSync(join(outDir, `${stamp}.json`), JSON.stringify(summary, null, 2));

console.log(`\ncoverage avg ${(summary.averages.citedParagraphRatio * 100).toFixed(1)}% (gate ≥${THRESHOLDS.citedParagraphRatio * 100}%) · degraded avg ${(summary.averages.degradedRatio * 100).toFixed(1)}% · cost avg $${summary.averages.costUsd.toFixed(3)}`);
console.log(summary.pass ? '\nLIVE EVAL PASSED' : '\nLIVE EVAL FAILED');
process.exit(summary.pass ? 0 : 1);
