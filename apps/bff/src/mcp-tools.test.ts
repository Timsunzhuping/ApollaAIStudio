import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@apolla/harness-core';
import { buildHarness, type Harness } from './harness';
import { buildCapabilityTools, buildResourceProvider, buildPromptProvider } from './mcp-tools';

let harness: Harness;
let server: McpServer;

beforeAll(async () => {
  harness = await buildHarness(); // in-memory (no DATABASE_URL) + stub providers
  server = new McpServer(buildCapabilityTools(harness), { resources: buildResourceProvider(harness), prompts: buildPromptProvider(harness) });
});
afterAll(async () => { await harness.close?.(); });

const call = (name: string, args: unknown, ownerId: string) =>
  server.handle({ method: 'tools/call', id: 1, params: { name, arguments: args } }, ownerId);
const text = (res: { result?: unknown }) => (res.result as { content: { text: string }[] }).content[0]!.text;

describe('Apolla capability tools (S18)', () => {
  it('lists the read-only capability tools', async () => {
    const res = await server.handle({ method: 'tools/list', id: 1 }, 'u');
    const names = (res.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['apolla.research', 'apolla.translate', 'apolla.list_skills', 'apolla.workspace_read']));
  });

  it('translates text via the surface capability', async () => {
    const res = await call('apolla.translate', { text: 'hello world', targetLang: 'French' }, 'owner-a');
    expect(typeof text(res)).toBe('string');
    expect(text(res).length).toBeGreaterThan(0);
  });

  it('workspace tools are owner-scoped', async () => {
    // owner-a writes a file via the translate capability (output lands in their workspace)
    await call('apolla.translate', { text: 'scoped doc', targetLang: 'German' }, 'owner-a');
    const listA = JSON.parse(text(await call('apolla.workspace_list', {}, 'owner-a'))) as { path: string }[];
    expect(listA.length).toBeGreaterThan(0);
    // a different owner sees none of owner-a's files
    const listB = JSON.parse(text(await call('apolla.workspace_list', {}, 'owner-b'))) as unknown[];
    expect(listB).toHaveLength(0);
    // reading owner-a's path as owner-b fails (cross-tenant)
    const cross = await call('apolla.workspace_read', { path: listA[0]!.path }, 'owner-b');
    expect((cross.result as { isError?: boolean }).isError).toBe(true);
  });
});

describe('MCP resources + prompts (S35/B5)', () => {
  it('advertises the new capabilities in initialize', async () => {
    const res = await server.handle({ method: 'initialize', id: 1 }, 'u');
    const caps = (res.result as { capabilities: Record<string, unknown> }).capabilities;
    expect(Object.keys(caps).sort()).toEqual(['prompts', 'resources', 'tools']);
    // a bare S18-style server (no providers) still advertises tools only
    const bare = await new McpServer(buildCapabilityTools(harness)).handle({ method: 'initialize', id: 1 }, 'u');
    expect(Object.keys((bare.result as { capabilities: Record<string, unknown> }).capabilities)).toEqual(['tools']);
  });

  it('lists workspace files as resources and reads them back, owner-scoped', async () => {
    await harness.workspace.write({ ownerId: 'res-owner', path: 'notes/plan.md', content: '# plan' });
    const list = await server.handle({ method: 'resources/list', id: 1 }, 'res-owner');
    const resources = (list.result as { resources: { uri: string; name: string }[] }).resources;
    const uri = resources.find((r) => r.name === 'notes/plan.md')!.uri;
    expect(uri).toBe('apolla://workspace/notes/plan.md');

    const read = await server.handle({ method: 'resources/read', id: 2, params: { uri } }, 'res-owner');
    expect((read.result as { contents: { text: string }[] }).contents[0]!.text).toBe('# plan');

    // cross-tenant: another owner cannot read the same uri
    const cross = await server.handle({ method: 'resources/read', id: 3, params: { uri } }, 'other-owner');
    expect(cross.error?.code).toBe(-32002);
  });

  it('exposes owner skills as prompt templates with the input argument filled in', async () => {
    await harness.skillRepo.save('pr-owner', { name: 'weekly-digest', description: 'Summarize the week', promptRef: 'p1', allowTools: [] } as never);
    const list = await server.handle({ method: 'prompts/list', id: 1 }, 'pr-owner');
    const prompts = (list.result as { prompts: { name: string }[] }).prompts;
    expect(prompts.map((p) => p.name)).toContain('weekly-digest');

    const got = await server.handle({ method: 'prompts/get', id: 2, params: { name: 'weekly-digest', arguments: { input: 'sprint 35' } } }, 'pr-owner');
    const msg = (got.result as { messages: { content: { text: string } }[] }).messages[0]!.content.text;
    expect(msg).toContain('weekly-digest');
    expect(msg).toContain('sprint 35');
    // unknown prompt + cross-tenant both fail closed
    expect((await server.handle({ method: 'prompts/get', id: 3, params: { name: 'nope' } }, 'pr-owner')).error?.code).toBe(-32602);
    expect((await server.handle({ method: 'prompts/get', id: 4, params: { name: 'weekly-digest' } }, 'other')).error?.code).toBe(-32602);
  });
});
