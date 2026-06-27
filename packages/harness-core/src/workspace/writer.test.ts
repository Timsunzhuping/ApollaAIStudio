import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig } from '@apolla/contracts';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { InMemoryWorkspaceRepository } from './memory';
import { WriterOrchestrator, type WriterEvent } from './writer';

const prompts = new PromptRegistry([
  { promptId: 'writer.edit', version: '1', scene: 'w', template: 'Edit the document.', safetyConstraints: [], rollout: 1 },
]);
function router(streamText: string): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', { streamText })]]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
}
async function collect(it: AsyncIterable<WriterEvent>): Promise<WriterEvent[]> {
  const out: WriterEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('WriterOrchestrator', () => {
  it('edits a workspace doc into a new version, preserving the old one', async () => {
    const ws = new InMemoryWorkspaceRepository();
    await ws.write({ ownerId: 'u', path: 'report.md', content: 'original conclusion in Chinese' });
    const writer = new WriterOrchestrator({ router: router('EDITED DOC'), prompts, workspace: ws });

    const events = await collect(writer.run({ ownerId: 'u', path: 'report.md', instruction: 'translate conclusion to English' }));
    expect(events[0]).toMatchObject({ type: 'read', version: 1 });
    expect(events.some((e) => e.type === 'written' && e.version === 2)).toBe(true);
    expect(events.at(-1)?.type).toBe('done');

    expect((await ws.read('u', 'report.md'))?.content).toBe('EDITED DOC');
    expect((await ws.read('u', 'report.md', { version: 1 }))?.content).toBe('original conclusion in Chinese');
    expect(await ws.history('u', 'report.md')).toHaveLength(2);
  });

  it('errors cleanly on a missing file', async () => {
    const writer = new WriterOrchestrator({ router: router('x'), prompts, workspace: new InMemoryWorkspaceRepository() });
    const events = await collect(writer.run({ ownerId: 'u', path: 'nope.md', instruction: 'edit' }));
    expect(events[0]?.type).toBe('error');
  });
});
