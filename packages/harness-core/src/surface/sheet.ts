import { z } from 'zod';
import type { ModelAlias } from '@apolla/contracts';
import { assembleRequest } from '../safety/untrusted';
import type { SurfaceExecCtx, SurfaceChunk } from './types';
import { evaluateSheet } from './formula';

export const SheetSchema = z.object({
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).default([]),
});
export type Sheet = z.infer<typeof SheetSchema>;
const ColumnValues = z.object({ values: z.array(z.string()) });

/** RFC-4180-ish CSV encode: quote fields containing a comma, quote, or newline. */
function encodeCsv(sheet: Sheet): string {
  const esc = (f: string): string => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);
  return [sheet.columns, ...sheet.rows].map((row) => row.map(esc).join(',')).join('\n');
}

/** Minimal CSV decode handling quoted fields (enough to round-trip our own output). */
function decodeCsv(text: string): Sheet {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); records.push(row); field = ''; row = []; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const [columns = [], ...rows] = records;
  return { columns, rows };
}

/**
 * Sheet executor (S8-T3): structured tables via router.json (zod-validated). `mode`:
 *  - generate  : input text/prompt → a new table.
 *  - addColumn : input CSV doc → append one AI-filled column (row count unchanged).
 *  - summarize : input CSV doc → a short Markdown summary of the table.
 * Invalid structured output throws (zod) so the runtime degrades safely — no half-written file.
 */
export async function* sheetExecutor(ctx: SurfaceExecCtx, alias: ModelAlias = 'gpt_premium'): AsyncIterable<SurfaceChunk> {
  const mode = String(ctx.params.mode ?? 'generate');

  // compute (S34/B4): evaluate =formulas deterministically — NO LLM. Numbers users act on must come
  // from arithmetic, not token prediction; this is the only mode with zero model calls.
  if (mode === 'compute') {
    const { sheet: computed, errors } = evaluateSheet(decodeCsv(ctx.inputContent));
    yield { content: encodeCsv(computed), structured: { ...computed, formulaErrors: errors } };
    return;
  }

  const system = ctx.prompts.render(ctx.surface.promptRef, { mode }).text;

  if (mode === 'addColumn') {
    const sheet = decodeCsv(ctx.inputContent);
    const column = String(ctx.params.column ?? 'notes');
    const user = `Add a column named "${column}". Return { "values": [...] } with exactly ${sheet.rows.length} values, one per row in order.`;
    const out = await ctx.router.json(alias, assembleRequest({ system, user, data: [{ kind: 'untrusted', sourceId: 'sheet', origin: 'surface:input', content: ctx.inputContent }] }), ColumnValues);
    const next: Sheet = {
      columns: [...sheet.columns, column],
      rows: sheet.rows.map((r, i) => [...r, out.values[i] ?? '']),
    };
    yield { content: encodeCsv(next), structured: next };
    return;
  }

  if (mode === 'summarize') {
    const user = 'Summarize the table below in 3-5 Markdown bullet points.';
    const text = await ctx.router.completeText(alias, assembleRequest({ system, user, data: [{ kind: 'untrusted', sourceId: 'sheet', origin: 'surface:input', content: ctx.inputContent }] }));
    yield { content: text.trim() };
    return;
  }

  // generate
  const user = 'Build a table answering the request below.';
  const sheet = SheetSchema.parse(await ctx.router.json(alias, assembleRequest({ system, user, data: [{ kind: 'untrusted', sourceId: 'sheet', origin: 'surface:input', content: ctx.inputContent }] }), SheetSchema));
  yield { content: encodeCsv(sheet), structured: sheet };
}
