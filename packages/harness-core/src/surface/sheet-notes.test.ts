import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig, Surface } from '@apolla/contracts';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { InMemoryWorkspaceRepository } from '../workspace/memory';
import { SurfaceRuntime } from './runtime';
import { sheetExecutor } from './sheet';
import { notesExecutor } from './executors';
import type { SurfaceEvent } from './types';

const prompts = new PromptRegistry([
  { promptId: 'surface.sheet', version: '1', scene: 's', template: 'tables. mode {{mode}}.', safetyConstraints: [], rollout: 1 },
  { promptId: 'surface.notes', version: '1', scene: 'n', template: 'notes.', safetyConstraints: [], rollout: 1 },
]);
function router(text: string): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', { text })]]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
}
function build(text: string) {
  const workspace = new InMemoryWorkspaceRepository();
  const rt = new SurfaceRuntime({ router: router(text), prompts, workspace })
    .registerExecutor('sheet', (c) => sheetExecutor(c))
    .registerExecutor('notes', (c) => notesExecutor(c));
  return { rt, workspace };
}
async function collect(it: AsyncIterable<SurfaceEvent>): Promise<SurfaceEvent[]> {
  const out: SurfaceEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const sheet: Surface = { id: 'sheet', title: 'Sheets', inputKind: 'text', params: { mode: 'generate' }, promptRef: 'surface.sheet', outputMime: 'text/csv', executor: 'sheet' };
const sheetEdit: Surface = { id: 'sheet-edit', title: 'Edit', inputKind: 'doc', params: { mode: 'addColumn', column: 'pros' }, promptRef: 'surface.sheet', outputMime: 'text/csv', executor: 'sheet' };
const notes: Surface = { id: 'notes', title: 'Notes', inputKind: 'text', params: {}, promptRef: 'surface.notes', outputMime: 'text/markdown', executor: 'notes' };

describe('Sheets surface', () => {
  it('generates a valid CSV table from a prompt', async () => {
    const { rt, workspace } = build('{"columns":["A","B"],"rows":[["1","2"],["3","4"]]}');
    await collect(rt.run({ ownerId: 'u', surface: sheet, text: 'make a table', outputPath: 'table.csv' }));
    const csv = (await workspace.read('u', 'table.csv'))?.content;
    expect(csv).toBe('A,B\n1,2\n3,4');
  });

  it('addColumn appends one column, row count unchanged, as a new version', async () => {
    const { rt, workspace } = build('{"values":["p1","p2"]}');
    await workspace.write({ ownerId: 'u', path: 'table.csv', content: 'A,B\n1,2\n3,4' });
    await collect(rt.run({ ownerId: 'u', surface: sheetEdit, sourcePath: 'table.csv', params: { mode: 'addColumn', column: 'pros' }, outputPath: 'table.csv' }));
    const file = await workspace.read('u', 'table.csv');
    expect(file?.version).toBe(2);
    expect(file?.content).toBe('A,B,pros\n1,2,p1\n3,4,p2');
  });

  it('invalid structured output is rejected (zod) — nothing is written', async () => {
    const { rt, workspace } = build('{"not":"a table"}');
    const events = await collect(rt.run({ ownerId: 'u', surface: sheet, text: 'x', outputPath: 'bad.csv' }));
    expect(events.at(-1)?.type).toBe('error');
    expect(await workspace.read('u', 'bad.csv')).toBeUndefined();
  });
});

describe('Meeting Notes surface', () => {
  it('extracts structured notes (summary/decisions/action items) → Markdown', async () => {
    const { rt, workspace } = build('{"summary":"S","decisions":["d1"],"actionItems":[{"owner":"Al","task":"do x","due":"Fri"}]}');
    const events = await collect(rt.run({ ownerId: 'u', surface: notes, text: 'transcript...', outputPath: 'notes.md' }));
    const structured = events.find((e) => e.type === 'structured');
    expect(structured && structured.type === 'structured' && (structured.data as { actionItems: unknown[] }).actionItems).toHaveLength(1);
    const md = (await workspace.read('u', 'notes.md'))?.content ?? '';
    expect(md).toContain('## Action items');
    expect(md).toContain('**Al** — do x');
  });
});
