import { describe, it, expect } from 'vitest';
import { evaluateSheet, colToIndex, indexToCol } from './formula';
import type { Sheet } from './sheet';

const sheet = (rows: string[][], columns = ['A', 'B', 'C', 'D']): Sheet => ({ columns: columns.slice(0, Math.max(...rows.map((r) => r.length), 1)), rows });

describe('spreadsheet formula engine (S34/B4)', () => {
  it('column letter round-trip (A..Z, AA..)', () => {
    expect(colToIndex('A')).toBe(0);
    expect(colToIndex('Z')).toBe(25);
    expect(colToIndex('AA')).toBe(26);
    expect(indexToCol(0)).toBe('A');
    expect(indexToCol(27)).toBe('AB');
    for (const i of [0, 5, 25, 26, 51, 700]) expect(colToIndex(indexToCol(i))).toBe(i);
  });

  it('arithmetic, precedence, parentheses, unary minus, power', () => {
    // NB: like Excel, unary minus binds tighter than ^ — so =-(2+3)^2 is (-5)^2 = 25, not -25.
    const { sheet: out, errors } = evaluateSheet(sheet([[ '2', '3', '=A1+B1*2', '=-(A1+B1)^2' ]]));
    expect(out.rows[0]).toEqual(['2', '3', '8', '25']);
    expect(evaluateSheet(sheet([['2', '3', '=-((A1+B1)^2)']])).sheet.rows[0]![2]).toBe('-25');
    expect(errors).toBe(0);
  });

  it('cell refs + dependency recalc across cells (formulas referencing formulas)', () => {
    const { sheet: out } = evaluateSheet(sheet([
      ['10', '20', '=A1+B1', '=C1*2'],
      ['5', '=C1', '=D1+B2', ''],
    ]));
    expect(out.rows[0]).toEqual(['10', '20', '30', '60']);
    expect(out.rows[1]).toEqual(['5', '30', '90', '']);
  });

  it('SUM/AVERAGE/MIN/MAX/COUNT over ranges (text cells skipped), ROUND/ABS/IF, comparisons', () => {
    const { sheet: out, errors } = evaluateSheet(sheet([
      ['1', '2', 'n/a', '=SUM(A1:C1)'],
      ['4', '10', '=AVERAGE(A1:B2)', '=MAX(A1:B2)-MIN(A1:B2)'],
      ['=COUNT(A1:C2)', '=ROUND(10/3,2)', '=ABS(0-7)', '=IF(A1>=1,B1*10,0)'],
    ]));
    expect(errors).toBe(0);
    expect(out.rows[0]![3]).toBe('3'); // 1+2, 'n/a' skipped
    expect(out.rows[1]![2]).toBe('4.25'); // (1+2+4+10)/4
    expect(out.rows[1]![3]).toBe('9');
    // COUNT sees 1,2,4,10 plus C2 — a formula cell that COMPUTES to a number also counts (like Excel).
    expect(out.rows[2]).toEqual(['5', '3.33', '7', '20']);
  });

  it('errors are precise and contained: #REF!, #DIV/0!, #VALUE!, unknown fn, cycles', () => {
    const { sheet: out, errors } = evaluateSheet(sheet([
      ['=Z99', '=1/0', '=A1+', '=NOPE(1)'],
      ['=B2', '=A2', 'ok', '=SUM(A1:B1)'],
    ]));
    expect(out.rows[0]).toEqual(['#REF!', '#DIV/0!', '#VALUE!', '#VALUE!']);
    // A2/B2 reference each other → both cycle; the plain cell is untouched
    expect(out.rows[1]![0]).toBe('#CYCLE!');
    expect(out.rows[1]![1]).toBe('#CYCLE!');
    expect(out.rows[1]![2]).toBe('ok');
    expect(errors).toBeGreaterThanOrEqual(6);
  });

  it('empty cells are 0 in arithmetic; numbers with thousands separators parse', () => {
    const { sheet: out } = evaluateSheet(sheet([['1,500', '', '=A1+B1+1']]));
    expect(out.rows[0]![2]).toBe('1501');
  });

  it('deterministic: same input → same output', () => {
    const s = sheet([['3', '=A1^2', '=SUM(A1:B1)']]);
    expect(evaluateSheet(s)).toEqual(evaluateSheet(s));
  });
});
