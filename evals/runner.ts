import { runGolden } from './src/golden';
import {
  checkGoldenStructure,
  checkCitationCorrectness,
  checkCostRegression,
  type CheckResult,
} from './src/checks';
import { runScenarios } from './src/scenarios';

/** Baseline cost for the deterministic golden (mock pricing). Tighten as the loop evolves. */
const BASELINE_USD = 0.001;

const { task, totalUsd } = await runGolden();

const results: CheckResult[] = [
  checkGoldenStructure(task),
  checkCitationCorrectness(task),
  checkCostRegression(totalUsd, BASELINE_USD),
  ...(await runScenarios()),
];

console.log('Apolla eval — research golden\n');
let failed = false;
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  for (const issue of r.issues) console.log(`          - ${issue}`);
  if (!r.ok) failed = true;
}
console.log(`\n  cost $${totalUsd.toFixed(5)} (baseline $${BASELINE_USD.toFixed(5)})`);
console.log(`\n${failed ? 'EVAL FAILED' : 'EVAL PASSED'}`);

process.exit(failed ? 1 : 0);
