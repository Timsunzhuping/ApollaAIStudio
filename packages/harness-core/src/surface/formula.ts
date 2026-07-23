import type { Sheet } from './sheet';

/**
 * Deterministic spreadsheet formula engine (S34 / B4). Cells starting with `=` are formulas over
 * A1-style references (columns A..Z,AA.., rows are 1-based DATA rows — the header row is not
 * addressable). Supported: + - * / ^, unary minus, parentheses, comparisons (= <> > < >= <=),
 * ranges in functions, and SUM/AVERAGE/MIN/MAX/COUNT/ROUND/ABS/IF.
 *
 * Evaluation builds a dependency graph with memoization; cycles yield #CYCLE!, bad references #REF!,
 * non-numeric operands #VALUE!, division by zero #DIV/0!. Pure and synchronous — no LLM, no I/O —
 * so recalculation is instant and hermetically testable. This is deliberately NOT an LLM feature:
 * numbers users act on must come from arithmetic, not token prediction.
 */

// ---------- A1 references ----------
export function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// ---------- tokenizer ----------
type Tok =
  | { t: 'num'; v: number }
  | { t: 'ref'; col: number; row: number }
  | { t: 'range'; c1: number; r1: number; c2: number; r2: number }
  | { t: 'fn'; name: string }
  | { t: 'op'; v: string }
  | { t: '(' } | { t: ')' } | { t: ',' };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ' || c === '\t') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(i))!;
      toks.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z]+[0-9]*/.exec(s.slice(i))!;
      const word = m[0].toUpperCase();
      i += m[0].length;
      const ref = /^([A-Z]+)([0-9]+)$/.exec(word);
      if (ref && s[i] === ':') {
        const m2 = /^:([A-Za-z]+)([0-9]+)/.exec(s.slice(i));
        if (!m2) throw new Error('#REF!');
        i += m2[0].length;
        toks.push({ t: 'range', c1: colToIndex(ref[1]!), r1: Number(ref[2]) - 1, c2: colToIndex(m2[1]!.toUpperCase()), r2: Number(m2[2]) - 1 });
      } else if (ref) {
        toks.push({ t: 'ref', col: colToIndex(ref[1]!), row: Number(ref[2]) - 1 });
      } else {
        toks.push({ t: 'fn', name: word });
      }
      continue;
    }
    if (c === '(') { toks.push({ t: '(' }); i++; continue; }
    if (c === ')') { toks.push({ t: ')' }); i++; continue; }
    if (c === ',') { toks.push({ t: ',' }); i++; continue; }
    const two = s.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '<>') { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^=<>'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new Error('#VALUE!');
  }
  return toks;
}

// ---------- parser (recursive descent → AST) ----------
type Ast =
  | { k: 'num'; v: number }
  | { k: 'ref'; col: number; row: number }
  | { k: 'range'; c1: number; r1: number; c2: number; r2: number }
  | { k: 'bin'; op: string; l: Ast; r: Ast }
  | { k: 'neg'; e: Ast }
  | { k: 'call'; name: string; args: Ast[] };

function parse(toks: Tok[]): Ast {
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];

  function expr(): Ast { return cmp(); }
  function cmp(): Ast {
    let l = add();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && ['=', '<>', '>', '<', '>=', '<='].includes(t.v)) { eat(); l = { k: 'bin', op: t.v, l, r: add() }; }
      else return l;
    }
  }
  function add(): Ast {
    let l = mul();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) { eat(); l = { k: 'bin', op: t.v, l, r: mul() }; }
      else return l;
    }
  }
  function mul(): Ast {
    let l = pow();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) { eat(); l = { k: 'bin', op: t.v, l, r: pow() }; }
      else return l;
    }
  }
  function pow(): Ast {
    const l = unary();
    const t = peek();
    if (t?.t === 'op' && t.v === '^') { eat(); return { k: 'bin', op: '^', l, r: pow() }; } // right-assoc
    return l;
  }
  function unary(): Ast {
    const t = peek();
    if (t?.t === 'op' && t.v === '-') { eat(); return { k: 'neg', e: unary() }; }
    if (t?.t === 'op' && t.v === '+') { eat(); return unary(); }
    return atom();
  }
  function atom(): Ast {
    const t = eat();
    if (!t) throw new Error('#VALUE!');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'ref') return { k: 'ref', col: t.col, row: t.row };
    if (t.t === 'range') return { k: 'range', c1: t.c1, r1: t.r1, c2: t.c2, r2: t.r2 };
    if (t.t === '(') {
      const e = expr();
      if (eat()?.t !== ')') throw new Error('#VALUE!');
      return e;
    }
    if (t.t === 'fn') {
      if (eat()?.t !== '(') throw new Error('#VALUE!');
      const args: Ast[] = [];
      if (peek()?.t !== ')') {
        args.push(expr());
        while (peek()?.t === ',') { eat(); args.push(expr()); }
      }
      if (eat()?.t !== ')') throw new Error('#VALUE!');
      return { k: 'call', name: t.name, args };
    }
    throw new Error('#VALUE!');
  }

  const ast = expr();
  if (p !== toks.length) throw new Error('#VALUE!');
  return ast;
}

// ---------- evaluator with dependency-aware memoization + cycle detection ----------
class SheetEval {
  private readonly memo = new Map<string, number | string>();
  private readonly inFlight = new Set<string>();
  constructor(private readonly sheet: Sheet) {}

  cell(col: number, row: number): number | string {
    if (row < 0 || row >= this.sheet.rows.length || col < 0 || col >= this.sheet.columns.length) throw new Error('#REF!');
    const key = `${col}:${row}`;
    if (this.memo.has(key)) return this.memo.get(key)!;
    if (this.inFlight.has(key)) throw new Error('#CYCLE!');
    const raw = (this.sheet.rows[row]?.[col] ?? '').trim();
    let val: number | string;
    if (raw.startsWith('=')) {
      this.inFlight.add(key);
      try {
        val = this.run(parse(tokenize(raw.slice(1))));
      } finally {
        this.inFlight.delete(key);
      }
    } else {
      const n = Number(raw.replace(/,/g, ''));
      val = raw !== '' && Number.isFinite(n) ? n : raw;
    }
    this.memo.set(key, val);
    return val;
  }

  private num(v: number | string): number {
    if (typeof v === 'number') return v;
    if (v.trim() === '') return 0; // empty cells count as 0 in arithmetic (spreadsheet convention)
    throw new Error('#VALUE!');
  }

  private flat(args: Ast[]): number[] {
    const out: number[] = [];
    for (const a of args) {
      if (a.k === 'range') {
        for (let r = Math.min(a.r1, a.r2); r <= Math.max(a.r1, a.r2); r++)
          for (let c = Math.min(a.c1, a.c2); c <= Math.max(a.c1, a.c2); c++) {
            const v = this.cell(c, r);
            if (typeof v === 'number') out.push(v); // ranges skip non-numeric cells (SUM over text = ignore)
          }
      } else {
        out.push(this.num(this.run(a)));
      }
    }
    return out;
  }

  run(a: Ast): number | string {
    switch (a.k) {
      case 'num': return a.v;
      case 'ref': return this.cell(a.col, a.row);
      case 'range': throw new Error('#VALUE!'); // a bare range is only valid inside a function
      case 'neg': return -this.num(this.run(a.e));
      case 'bin': {
        const l = this.run(a.l);
        const r = this.run(a.r);
        switch (a.op) {
          case '+': return this.num(l) + this.num(r);
          case '-': return this.num(l) - this.num(r);
          case '*': return this.num(l) * this.num(r);
          case '/': {
            const d = this.num(r);
            if (d === 0) throw new Error('#DIV/0!');
            return this.num(l) / d;
          }
          case '^': return Math.pow(this.num(l), this.num(r));
          case '=': return l === r || this.eqNum(l, r) ? 1 : 0;
          case '<>': return l === r || this.eqNum(l, r) ? 0 : 1;
          case '>': return this.num(l) > this.num(r) ? 1 : 0;
          case '<': return this.num(l) < this.num(r) ? 1 : 0;
          case '>=': return this.num(l) >= this.num(r) ? 1 : 0;
          case '<=': return this.num(l) <= this.num(r) ? 1 : 0;
          default: throw new Error('#VALUE!');
        }
      }
      case 'call': {
        const name = a.name;
        if (name === 'IF') {
          if (a.args.length !== 3) throw new Error('#VALUE!');
          return this.num(this.run(a.args[0]!)) !== 0 ? this.run(a.args[1]!) : this.run(a.args[2]!);
        }
        if (name === 'ROUND') {
          if (a.args.length < 1 || a.args.length > 2) throw new Error('#VALUE!');
          const x = this.num(this.run(a.args[0]!));
          const digits = a.args[1] ? this.num(this.run(a.args[1]!)) : 0;
          const f = Math.pow(10, digits);
          return Math.round(x * f) / f;
        }
        if (name === 'ABS') {
          if (a.args.length !== 1) throw new Error('#VALUE!');
          return Math.abs(this.num(this.run(a.args[0]!)));
        }
        const vals = this.flat(a.args);
        switch (name) {
          case 'SUM': return vals.reduce((s, v) => s + v, 0);
          case 'AVG':
          case 'AVERAGE': {
            if (vals.length === 0) throw new Error('#DIV/0!');
            return vals.reduce((s, v) => s + v, 0) / vals.length;
          }
          case 'MIN': return vals.length ? Math.min(...vals) : 0;
          case 'MAX': return vals.length ? Math.max(...vals) : 0;
          case 'COUNT': return vals.length;
          default: throw new Error('#VALUE!'); // unknown function
        }
      }
    }
  }

  private eqNum(l: number | string, r: number | string): boolean {
    return typeof l === 'number' && typeof r === 'number' && l === r;
  }
}

/** Format a computed value for display: trim float noise to ≤6 decimals. */
function display(v: number | string): string {
  if (typeof v === 'string') return v;
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(6)));
}

/**
 * Evaluate every formula cell of a sheet. Returns a new sheet whose formula cells hold the computed
 * display value (errors as #REF!/#VALUE!/#CYCLE!/#DIV/0!) plus the error count. Non-formula cells
 * pass through untouched.
 */
export function evaluateSheet(sheet: Sheet): { sheet: Sheet; errors: number } {
  const ev = new SheetEval(sheet);
  let errors = 0;
  const rows = sheet.rows.map((row, r) =>
    row.map((cell, c) => {
      if (!cell.trim().startsWith('=')) return cell;
      try {
        return display(ev.cell(c, r));
      } catch (e) {
        errors++;
        return e instanceof Error && e.message.startsWith('#') ? e.message : '#VALUE!';
      }
    }),
  );
  return { sheet: { columns: sheet.columns, rows }, errors };
}
