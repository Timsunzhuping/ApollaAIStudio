import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { encryptSecret } from '@apolla/harness-core';
import { StubHttpMcpServer } from '@apolla/mcp-stdio';
import { buildHarness, type Harness } from './harness';

let harness: Harness;
const stub = new StubHttpMcpServer({ requireToken: 'sekret' });
let url: string;

beforeAll(async () => {
  harness = await buildHarness();
  url = await stub.start();
});
afterAll(async () => {
  await stub.stop();
  await harness.close?.();
});

async function addHttpConnector(ownerId: string, opts: { url: string; token?: string }) {
  await harness.connectors.save({
    id: `c_${ownerId}`,
    ownerId,
    name: 'remote',
    transport: 'http',
    url: opts.url,
    args: [],
    readOnlyTools: ['echo'],
    disabledTools: [],
    enabled: true,
    tools: [],
    secrets: opts.token ? { token: encryptSecret(opts.token) } : {},
  });
}

describe('remote MCP over HTTP (S11-T2)', () => {
  it('enumerates remote tools with conservative risk and runs a remote call', async () => {
    const owner = (await harness.users.upsertByEmail('rmt1@x.ai')).id;
    await addHttpConnector(owner, { url, token: 'sekret' });
    const rt = await harness.agentToolsFor(owner);
    expect(rt.get('remote/echo').risk).toBe('read'); // readOnlyTools → read
    expect(rt.get('remote/save_note').risk).toBe('low_write'); // remote write defaults low_write, never high
    const r = await rt.invoke('remote/echo', { hi: 1 });
    expect(r.ok).toBe(true);
    expect(r.data[0]?.kind).toBe('untrusted'); // remote output enters the data channel
  });

  it('isolates an unreachable connector without breaking the tool set', async () => {
    const owner = (await harness.users.upsertByEmail('rmt2@x.ai')).id;
    await addHttpConnector(owner, { url: 'http://127.0.0.1:1/nope' }); // unroutable
    const rt = await harness.agentToolsFor(owner);
    expect(rt.get('web_search')).toBeTruthy(); // built-ins still present
    expect(rt.list().some((t) => t.name.startsWith('remote/'))).toBe(false); // bad connector skipped
  });

  it('a connector missing the required token cannot enumerate tools (auth enforced)', async () => {
    const owner = (await harness.users.upsertByEmail('rmt3@x.ai')).id;
    await addHttpConnector(owner, { url }); // no token → server 401 → skipped
    const rt = await harness.agentToolsFor(owner);
    expect(rt.list().some((t) => t.name.startsWith('remote/'))).toBe(false);
  });
});
