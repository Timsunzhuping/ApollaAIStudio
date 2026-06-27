import {
  InMemoryWorkspaceRepository,
  GuardedWorkspaceRepository,
  makeWorkspaceTools,
  WriterOrchestrator,
  Coordinator,
  AgentOrchestrator,
  ToolRuntime,
  StubMCPClient,
  ModelRouter,
  MockAdapter,
  PromptRegistry,
  type CoworkEvent,
  type WriterEvent,
} from '@apolla/harness-core';
import type { ModelAlias, RouteConfig, AuditEntry } from '@apolla/contracts';
import type { CheckResult } from './checks';

const prompts = new PromptRegistry([
  { promptId: 'agent.step', version: '1', scene: 'a', template: 'Decide.', safetyConstraints: [], rollout: 1 },
  { promptId: 'cowork.synthesize', version: '1', scene: 's', template: 'Synthesize.', safetyConstraints: [], rollout: 1 },
  { promptId: 'writer.edit', version: '1', scene: 'w', template: 'Edit the document.', safetyConstraints: [], rollout: 1 },
]);
function router(behavior: { jsonSequence?: string[]; streamText?: string }): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', behavior)]]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
}
async function tools(): Promise<ToolRuntime> {
  const rt = new ToolRuntime();
  await rt.connectMCP(new StubMCPClient(), { name: 'demo', transport: 'stub', readOnlyTools: ['echo'] });
  return rt;
}

/** ① Versioning: write twice → versions increment; read latest/old; rollback restores. */
export async function versionRoundTrip(): Promise<CheckResult> {
  const ws = new InMemoryWorkspaceRepository();
  await ws.write({ ownerId: 'u', path: 'r.md', content: 'first' });
  await ws.write({ ownerId: 'u', path: 'r.md', content: 'second' });
  const latest = await ws.read('u', 'r.md');
  const old = await ws.read('u', 'r.md', { version: 1 });
  const back = await ws.rollback('u', 'r.md', 1);
  const ok = latest?.version === 2 && latest.content === 'second' && old?.content === 'first' && back.version === 3 && back.content === 'first';
  return { name: 'workspace-versioning', ok, issues: ok ? [] : ['versioning/read/rollback did not behave'] };
}

/** ② File-tool safety: fs_write denied in background without allowlist, executed with it; fs_read auto. */
export async function fileToolSafety(): Promise<CheckResult> {
  const run = async (allow: string[]): Promise<{ audited: AuditEntry[]; ws: InMemoryWorkspaceRepository }> => {
    const ws = new InMemoryWorkspaceRepository();
    const rt = await tools();
    for (const t of makeWorkspaceTools(ws, { ownerId: 'u' })) rt.register(t);
    const r = router({ jsonSequence: ['{"action":"call_tool","tool":"fs_write","args":{"path":"o.md","content":"d"}}', '{"action":"finish","answer":"done"}'] });
    const audited: AuditEntry[] = [];
    const set = new Set(allow);
    for await (const _e of new AgentOrchestrator({ router: r, tools: rt, prompts, audit: (e) => { audited.push(e); } }).run({ ownerId: 'u', goal: 'g', taskId: 't', approve: async (c) => set.has(c.tool) })) void _e;
    return { audited, ws };
  };
  const denied = await run([]);
  const allowed = await run(['fs_write']);
  const ok =
    !denied.audited.some((e) => e.tool === 'fs_write' && e.status === 'executed') &&
    (await denied.ws.read('u', 'o.md')) === undefined &&
    allowed.audited.some((e) => e.tool === 'fs_write' && e.status === 'executed');
  return { name: 'workspace-file-tool-safety', ok, issues: ok ? [] : ['fs_write background gating failed'] };
}

/** ③ Path isolation: a traversal write is rejected + audited; nothing lands. */
export async function pathIsolation(): Promise<CheckResult> {
  const audited: AuditEntry[] = [];
  const ws = new GuardedWorkspaceRepository({ base: new InMemoryWorkspaceRepository(), audit: (e) => { audited.push(e); } });
  let rejected = false;
  try {
    await ws.write({ ownerId: 'u', path: '../../etc/passwd', content: 'x' });
  } catch {
    rejected = true;
  }
  const ok = rejected && audited.some((e) => e.status === 'denied') && (await ws.list('u')).length === 0;
  return { name: 'workspace-path-isolation', ok, issues: ok ? [] : ['traversal path was not rejected/audited'] };
}

/** ④ Writer produces a new version whose content actually changed. */
export async function writerNewVersion(): Promise<CheckResult> {
  const ws = new InMemoryWorkspaceRepository();
  await ws.write({ ownerId: 'u', path: 'doc.md', content: 'original' });
  const writer = new WriterOrchestrator({ router: router({ streamText: 'EDITED' }), prompts, workspace: ws });
  const events: WriterEvent[] = [];
  for await (const e of writer.run({ ownerId: 'u', path: 'doc.md', instruction: 'rewrite' })) events.push(e);
  const latest = await ws.read('u', 'doc.md');
  const ok = events.some((e) => e.type === 'written' && e.version === 2) && latest?.content === 'EDITED';
  return { name: 'workspace-writer', ok, issues: ok ? [] : ['Writer did not produce a changed new version'] };
}

/** ⑤ Cowork file collaboration: sections + brief land in the workspace when authorized. */
export async function coworkFileCollab(): Promise<CheckResult> {
  const r = router({ jsonSequence: ['{"action":"finish","answer":"sec"}'], streamText: 'BRIEF' });
  const ws = new InMemoryWorkspaceRepository();
  const coord = new Coordinator({ agent: new AgentOrchestrator({ router: r, tools: await tools(), prompts }), router: r, prompts, workspace: ws });
  const events: CoworkEvent[] = [];
  for await (const e of coord.run({ ownerId: 'u', goal: 'g', subgoals: ['a', 'b'], taskId: 't', files: { enabled: true, basePath: 'cowork/t' } })) events.push(e);
  const paths = (await ws.list('u')).map((f) => f.path);
  const ok =
    paths.includes('cowork/t/sections/1.md') &&
    paths.includes('cowork/t/sections/2.md') &&
    paths.includes('cowork/t/brief.md') &&
    events.filter((e) => e.type === 'file-written').length === 3;
  return { name: 'workspace-cowork-collab', ok, issues: ok ? [] : ['cowork did not persist sections + brief'] };
}

export async function runWorkspaceScenarios(): Promise<CheckResult[]> {
  return Promise.all([versionRoundTrip(), fileToolSafety(), pathIsolation(), writerNewVersion(), coworkFileCollab()]);
}
