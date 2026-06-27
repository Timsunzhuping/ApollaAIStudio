import {
  InMemoryWorkspaceRepository,
  SurfaceRuntime,
  translateExecutor,
  sheetExecutor,
  notesExecutor,
  ModelRouter,
  MockAdapter,
  PromptRegistry,
  type SurfaceEvent,
} from '@apolla/harness-core';
import type { ModelAlias, RouteConfig, Surface, SurfaceExecutor } from '@apolla/contracts';
import type { CheckResult } from './checks';

const prompts = new PromptRegistry([
  { promptId: 'surface.translate', version: '1', scene: 't', template: 'Translate into {{targetLang}} from {{sourceLang}}.', safetyConstraints: [], rollout: 1 },
  { promptId: 'surface.sheet', version: '1', scene: 's', template: 'tables. Mode: {{mode}}.', safetyConstraints: [], rollout: 1 },
  { promptId: 'surface.notes', version: '1', scene: 'n', template: 'notes.', safetyConstraints: [], rollout: 1 },
]);
function router(behavior: { text?: string; streamText?: string }): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', behavior)]]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
}
function runtime(behavior: { text?: string; streamText?: string }) {
  const workspace = new InMemoryWorkspaceRepository();
  const rt = new SurfaceRuntime({ router: router(behavior), prompts, workspace })
    .registerExecutor('translate', (c) => translateExecutor(c))
    .registerExecutor('sheet', (c) => sheetExecutor(c))
    .registerExecutor('notes', (c) => notesExecutor(c));
  return { rt, workspace };
}
async function collect(it: AsyncIterable<SurfaceEvent>): Promise<SurfaceEvent[]> {
  const out: SurfaceEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const S = (id: string, inputKind: 'text' | 'doc', executor: SurfaceExecutor, promptRef: string, outputMime = 'text/markdown'): Surface => ({ id, title: id, inputKind, params: {}, promptRef, outputMime, executor });

/** ① Translate writes a structure-preserving translation to a new workspace file. */
export async function translateSurface(): Promise<CheckResult> {
  const { rt, workspace } = runtime({ streamText: '# Title\n\n- a\n- b' });
  await workspace.write({ ownerId: 'u', path: 'r.md', content: '# 标题\n\n- 甲\n- 乙' });
  await collect(rt.run({ ownerId: 'u', surface: S('translate', 'doc', 'translate', 'surface.translate'), sourcePath: 'r.md', params: { targetLang: 'English' }, outputPath: 'r.en.md' }));
  const out = await workspace.read('u', 'r.en.md');
  const src = await workspace.read('u', 'r.md');
  const ok = out?.content.includes('# Title') === true && src?.content === '# 标题\n\n- 甲\n- 乙';
  return { name: 'surface-translate', ok, issues: ok ? [] : ['translation not written / source not preserved'] };
}

/** ② Sheet generate → valid CSV; addColumn keeps row count and adds one column. */
export async function sheetSurface(): Promise<CheckResult> {
  const gen = runtime({ text: '{"columns":["A","B"],"rows":[["1","2"],["3","4"]]}' });
  await collect(gen.rt.run({ ownerId: 'u', surface: S('sheet', 'text', 'sheet', 'surface.sheet', 'text/csv'), text: 'make a table', outputPath: 't.csv' }));
  const v1 = (await gen.workspace.read('u', 't.csv'))?.content;

  const edit = runtime({ text: '{"values":["p1","p2"]}' });
  await edit.workspace.write({ ownerId: 'u', path: 't.csv', content: 'A,B\n1,2\n3,4' });
  await collect(edit.rt.run({ ownerId: 'u', surface: { ...S('sheet-edit', 'doc', 'sheet', 'surface.sheet', 'text/csv'), params: { mode: 'addColumn', column: 'pros' } }, sourcePath: 't.csv', params: { mode: 'addColumn', column: 'pros' }, outputPath: 't.csv' }));
  const v2 = await edit.workspace.read('u', 't.csv');
  const ok = v1 === 'A,B\n1,2\n3,4' && v2?.version === 2 && v2.content === 'A,B,pros\n1,2,p1\n3,4,p2';
  return { name: 'surface-sheet', ok, issues: ok ? [] : ['sheet generate/addColumn incorrect'] };
}

/** ③ Meeting Notes extracts structured action items into Markdown. */
export async function notesSurface(): Promise<CheckResult> {
  const { rt, workspace } = runtime({ text: '{"summary":"S","decisions":["d1"],"actionItems":[{"owner":"Al","task":"x"}]}' });
  const events = await collect(rt.run({ ownerId: 'u', surface: S('notes', 'text', 'notes', 'surface.notes'), text: 'transcript', outputPath: 'n.md' }));
  const structured = events.find((e) => e.type === 'structured');
  const md = (await workspace.read('u', 'n.md'))?.content ?? '';
  const ok = !!structured && structured.type === 'structured' && (structured.data as { actionItems: unknown[] }).actionItems.length === 1 && md.includes('**Al** — x');
  return { name: 'surface-notes', ok, issues: ok ? [] : ['notes did not extract structured action items'] };
}

/** ④ Surface output is written to the workspace (versioned). */
export async function surfacePersistence(): Promise<CheckResult> {
  const { rt, workspace } = runtime({ streamText: 'V1' });
  const s = S('rewrite', 'text', 'translate', 'surface.translate'); // any executor that writes
  await collect(rt.run({ ownerId: 'u', surface: s, text: 'x', params: { targetLang: 'X' }, outputPath: 'p.md' }));
  await collect(rt.run({ ownerId: 'u', surface: s, text: 'y', params: { targetLang: 'X' }, outputPath: 'p.md' }));
  const file = await workspace.read('u', 'p.md');
  const ok = file?.version === 2;
  return { name: 'surface-persistence', ok, issues: ok ? [] : ['surface output not versioned in workspace'] };
}

/** ⑤ Invalid structured output is rejected (zod) and nothing is written. */
export async function structuredValidation(): Promise<CheckResult> {
  const { rt, workspace } = runtime({ text: '{"not":"a table"}' });
  const events = await collect(rt.run({ ownerId: 'u', surface: S('sheet', 'text', 'sheet', 'surface.sheet', 'text/csv'), text: 'x', outputPath: 'bad.csv' }));
  const ok = events.at(-1)?.type === 'error' && (await workspace.read('u', 'bad.csv')) === undefined;
  return { name: 'surface-structured-validation', ok, issues: ok ? [] : ['invalid structured output was not rejected / was written'] };
}

export async function runSurfaceScenarios(): Promise<CheckResult[]> {
  return Promise.all([translateSurface(), sheetSurface(), notesSurface(), surfacePersistence(), structuredValidation()]);
}
