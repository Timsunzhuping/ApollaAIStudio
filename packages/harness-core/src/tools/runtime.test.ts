import { describe, it, expect } from 'vitest';
import { ToolRuntime } from './runtime';
import { WebSearchTool } from './search';
import type { SearchProvider, SearchHit } from './search';

class FakeProvider implements SearchProvider {
  readonly name = 'fake';
  constructor(private readonly hits: SearchHit[]) {}
  async search(): Promise<SearchHit[]> {
    return this.hits;
  }
}

class ThrowingProvider implements SearchProvider {
  readonly name = 'boom';
  async search(): Promise<SearchHit[]> {
    throw new Error('network down');
  }
}

describe('ToolRuntime', () => {
  it('registers, lists, and invokes tools', async () => {
    const rt = new ToolRuntime();
    rt.register(new WebSearchTool(new FakeProvider([{ title: 'T', url: 'u', snippet: 's' }])));
    expect(rt.has('web_search')).toBe(true);
    expect(rt.list({ risk: 'read' }).map((d) => d.name)).toEqual(['web_search']);
    expect(rt.list({ risk: 'high_write' })).toEqual([]);
  });

  it('rejects duplicate registration and unknown lookups', () => {
    const rt = new ToolRuntime();
    const tool = new WebSearchTool(new FakeProvider([]));
    rt.register(tool);
    expect(() => rt.register(tool)).toThrow(/already registered/);
    expect(() => rt.get('nope')).toThrow(/Unknown tool/);
  });

});

describe('WebSearchTool', () => {
  it('wraps hits as UntrustedContent tagged with origin', async () => {
    const tool = new WebSearchTool(
      new FakeProvider([
        { title: 'EV report', url: 'https://a.com', snippet: 'sales up' },
        { title: 'EV news', url: 'https://b.com', snippet: 'new model' },
      ]),
    );
    const res = await tool.invoke({ query: 'EV market' });
    expect(res.ok).toBe(true);
    expect(res.data).toHaveLength(2);
    expect(res.data[0]).toMatchObject({ kind: 'untrusted', origin: 'https://a.com' });
    expect(res.data[0]!.content).toContain('EV report');
  });

  it('returns ok:false with an error message instead of throwing', async () => {
    const res = await new WebSearchTool(new ThrowingProvider()).invoke({ query: 'x' });
    expect(res.ok).toBe(false);
    expect(res.data).toEqual([]);
    expect(res.error).toContain('network down');
  });
});
