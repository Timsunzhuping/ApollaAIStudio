import { describe, expect, it } from 'vitest';
import { WebFetchTool, assertPublicHttpUrl } from './fetch';
import { StubFetchProvider } from './fetch-stub';
import { extractMainText } from './fetch-http';

describe('assertPublicHttpUrl (SSRF guard)', () => {
  const rejected = [
    'file:///etc/passwd',
    'ftp://example.com/x',
    'http://localhost/admin',
    'http://127.0.0.1:8080/',
    'http://0.0.0.0/',
    'http://10.1.2.3/internal',
    'http://192.168.1.1/router',
    'http://172.16.0.9/x',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x',
    'http://api.internal/x',
    'http://printer.local/x',
  ];
  for (const url of rejected) {
    it(`rejects ${url}`, () => expect(() => assertPublicHttpUrl(url)).toThrow());
  }
  for (const url of ['https://example.com/p', 'http://sub.domain.org/a?b=c', 'https://172.32.0.1/x']) {
    it(`accepts ${url}`, () => expect(() => assertPublicHttpUrl(url)).not.toThrow());
  }
});

describe('WebFetchTool', () => {
  const tool = new WebFetchTool(new StubFetchProvider());

  it('is a read-risk native tool named web_fetch', () => {
    expect(tool.name).toBe('web_fetch');
    expect(tool.risk).toBe('read');
    expect(tool.source).toBe('native');
  });

  it('emits paragraph-level untrusted content with origin = url', async () => {
    const res = await tool.invoke({ url: 'https://example.com/ev' });
    expect(res.ok).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(2);
    for (const c of res.data) {
      expect(c.kind).toBe('untrusted');
      expect(c.origin).toBe('https://example.com/ev');
      expect(c.sourceId).toMatch(/^fetch:[a-z0-9]+:\d+$/);
    }
  });

  it('refuses private addresses without calling the provider', async () => {
    const res = await tool.invoke({ url: 'http://169.254.169.254/latest/meta-data' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/private/);
  });

  it('injection fixture content is emitted as data (never as a tool action)', async () => {
    const res = await tool.invoke({ url: 'https://malicious.example/injected' });
    expect(res.ok).toBe(true);
    expect(res.data.some((d) => d.content.includes('IGNORE ALL PREVIOUS INSTRUCTIONS'))).toBe(true);
    expect(res.data.every((d) => d.kind === 'untrusted')).toBe(true);
  });
});

describe('extractMainText (readability-lite)', () => {
  const html = `<!doctype html><html><head><title>T</title><style>.x{}</style><script>bad()</script></head>
  <body><nav>Home About</nav><article>
  <h2>EV market update</h2>
  <p>Electric vehicle sales reached 17 million units globally in 2025, a 25% increase that year across the surveyed markets worldwide.</p>
  <p>Battery pack prices fell below &#36;90 per kilowatt-hour on average, crossing an affordability threshold noted by multiple analysts.</p>
  </article><footer>Copyright boilerplate to be stripped away entirely.</footer></body></html>`;
  const text = extractMainText(html);
  it('keeps article text and headings, strips chrome/script/style', () => {
    expect(text).toContain('## EV market update');
    expect(text).toContain('17 million units');
    expect(text).toContain('$90 per kilowatt-hour');
    expect(text).not.toContain('Home About');
    expect(text).not.toContain('bad()');
    expect(text).not.toContain('Copyright boilerplate');
  });
});
