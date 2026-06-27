import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig, Surface } from '@apolla/contracts';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { InMemoryWorkspaceRepository } from '../workspace/memory';
import { SurfaceRuntime } from './runtime';
import { genericExecutor, translateExecutor } from './executors';
import type { SurfaceEvent } from './types';

const prompts = new PromptRegistry([
  { promptId: 'surface.rewrite', version: '1', scene: 'r', template: 'Rewrite the document.', safetyConstraints: [], rollout: 1 },
  { promptId: 'surface.translate', version: '1', scene: 't', template: 'Translate into {{targetLang}} from {{sourceLang}}.', safetyConstraints: [], rollout: 1 },
]);
function router(streamText: string): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', { streamText })]]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
}
function build(streamText: string) {
  const workspace = new InMemoryWorkspaceRepository();
  const rt = new SurfaceRuntime({ router: router(streamText), prompts, workspace })
    .registerExecutor('generic', (c) => genericExecutor(c))
    .registerExecutor('translate', (c) => translateExecutor(c));
  return { rt, workspace };
}
async function collect(it: AsyncIterable<SurfaceEvent>): Promise<SurfaceEvent[]> {
  const out: SurfaceEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const rewrite: Surface = { id: 'rewrite', title: 'Rewrite', inputKind: 'text', params: {}, promptRef: 'surface.rewrite', outputMime: 'text/markdown', executor: 'generic' };
const translate: Surface = { id: 'translate', title: 'Translator', inputKind: 'doc', params: {}, promptRef: 'surface.translate', outputMime: 'text/markdown', executor: 'translate' };

describe('SurfaceRuntime', () => {
  it('runs a generic text surface and writes the result to the workspace', async () => {
    const { rt, workspace } = build('REWRITTEN');
    const events = await collect(rt.run({ ownerId: 'u', surface: rewrite, text: 'original text', outputPath: 'out.md' }));
    expect(events.some((e) => e.type === 'delta')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', version: 1 });
    expect((await workspace.read('u', 'out.md'))?.content).toBe('REWRITTEN');
  });

  it('translate reads a source doc (data channel) and writes the translation as a new file', async () => {
    const { rt, workspace } = build('TRANSLATED');
    await workspace.write({ ownerId: 'u', path: 'report.md', content: '# 报告\n\n结论' });
    const events = await collect(rt.run({ ownerId: 'u', surface: translate, sourcePath: 'report.md', params: { targetLang: 'English' }, outputPath: 'report.en.md' }));
    expect(events.some((e) => e.type === 'input')).toBe(true);
    expect((await workspace.read('u', 'report.en.md'))?.content).toBe('TRANSLATED');
    // source preserved
    expect((await workspace.read('u', 'report.md'))?.content).toBe('# 报告\n\n结论');
  });

  it('errors (does not throw) on a missing source doc or unknown executor', async () => {
    const { rt } = build('x');
    const miss = await collect(rt.run({ ownerId: 'u', surface: translate, sourcePath: 'nope.md', outputPath: 'o.md' }));
    expect(miss.at(-1)?.type).toBe('error');
    const unknown = await collect(rt.run({ ownerId: 'u', surface: { ...rewrite, executor: 'sheet' }, text: 'x', outputPath: 'o.md' }));
    expect(unknown.at(-1)?.type).toBe('error');
  });
});
