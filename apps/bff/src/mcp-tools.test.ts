import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@apolla/harness-core';
import { buildHarness, type Harness } from './harness';
import { buildCapabilityTools } from './mcp-tools';

let harness: Harness;
let server: McpServer;

beforeAll(async () => {
  harness = await buildHarness(); // in-memory (no DATABASE_URL) + stub providers
  server = new McpServer(buildCapabilityTools(harness));
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
