import { runGolden } from './src/golden';
import {
  checkGoldenStructure,
  checkCitationCorrectness,
  checkCostRegression,
  type CheckResult,
} from './src/checks';
import { runScenarios } from './src/scenarios';
import { runMediaScenarios } from './src/media-scenarios';
import { runAgentScenarios } from './src/agent-scenarios';
import { runAutonomyScenarios } from './src/autonomy-scenarios';
import { runCoworkScenarios } from './src/cowork-scenarios';
import { runWorkspaceScenarios } from './src/workspace-scenarios';
import { runSurfaceScenarios } from './src/surface-scenarios';
import { runRemoteToolScenarios } from './src/remote-tool-scenarios';
import { runBillingScenarios } from './src/billing-scenarios';
import { runIdentityScenarios } from './src/identity-scenarios';
import { runQueueScenarios } from './src/queue-scenarios';
import { runTracingScenarios } from './src/tracing-scenarios';
import { runMcpScenarios } from './src/mcp-scenarios';

/** Baseline cost for the deterministic golden (mock pricing). Tighten as the loop evolves. */
const BASELINE_USD = 0.001;

const { task, totalUsd } = await runGolden();

const results: CheckResult[] = [
  checkGoldenStructure(task),
  checkCitationCorrectness(task),
  checkCostRegression(totalUsd, BASELINE_USD),
  ...(await runScenarios()),
  ...(await runMediaScenarios()),
  ...(await runAgentScenarios()),
  ...(await runAutonomyScenarios()),
  ...(await runCoworkScenarios()),
  ...(await runWorkspaceScenarios()),
  ...(await runSurfaceScenarios()),
  ...(await runRemoteToolScenarios()),
  ...(await runBillingScenarios()),
  ...(await runIdentityScenarios()),
  ...(await runQueueScenarios()),
  ...(await runTracingScenarios()),
  ...(await runMcpScenarios()),
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
