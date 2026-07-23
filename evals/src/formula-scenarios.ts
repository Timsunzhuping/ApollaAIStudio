import { evaluateSheet } from '@apolla/harness-core';
import type { CheckResult } from './checks';

/**
 * Spreadsheet formula engine (S34/B4): numbers users act on must come from deterministic arithmetic,
 * never token prediction. Guards: correct math over refs/ranges, contained errors, cycle detection,
 * and bit-identical determinism. Fully offline (pure function).
 */
export async function formulaEngine(): Promise<CheckResult> {
  const issues: string[] = [];

  const { sheet: out, errors } = evaluateSheet({
    columns: ['item', 'qty', 'price', 'total'],
    rows: [
      ['widget', '2', '3.5', '=B1*C1'],
      ['gadget', '4', '10', '=B2*C2'],
      ['sum', '', '', '=SUM(D1:D2)'],
      ['avg', '', '', '=ROUND(AVERAGE(D1:D2),2)'],
      ['flag', '', '', '=IF(D3>40,1,0)'],
    ],
  });
  if (out.rows[0]![3] !== '7') issues.push(`row math wrong: ${out.rows[0]![3]}`);
  if (out.rows[1]![3] !== '40') issues.push(`row math wrong: ${out.rows[1]![3]}`);
  if (out.rows[2]![3] !== '47') issues.push(`range SUM wrong: ${out.rows[2]![3]}`);
  if (out.rows[3]![3] !== '23.5') issues.push(`AVERAGE/ROUND wrong: ${out.rows[3]![3]}`);
  if (out.rows[4]![3] !== '1') issues.push(`IF/comparison wrong: ${out.rows[4]![3]}`);
  if (errors !== 0) issues.push(`unexpected errors: ${errors}`);

  // Errors are contained per-cell (bad cells error; good cells still compute), cycles detected.
  const bad = evaluateSheet({ columns: ['a', 'b', 'c'], rows: [['=1/0', '=Z99', '=A2'], ['=C1', '5', '=B2*2']] });
  if (bad.sheet.rows[0]![0] !== '#DIV/0!') issues.push('div-by-zero not contained');
  if (bad.sheet.rows[0]![1] !== '#REF!') issues.push('bad ref not contained');
  if (bad.sheet.rows[0]![2] !== '#CYCLE!' || bad.sheet.rows[1]![0] !== '#CYCLE!') issues.push('cycle not detected');
  if (bad.sheet.rows[1]![2] !== '10') issues.push('healthy cell affected by sick neighbors');

  // Deterministic: identical output across runs.
  const s = { columns: ['x'], rows: [['=ROUND(10/3,4)']] };
  if (JSON.stringify(evaluateSheet(s)) !== JSON.stringify(evaluateSheet(s))) issues.push('non-deterministic');

  return { name: 'formula-engine', ok: issues.length === 0, issues };
}

export async function runFormulaScenarios(): Promise<CheckResult[]> {
  return [await formulaEngine()];
}
