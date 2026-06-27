import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from './api';

function fakeRes(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  };
}

describe('api client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs login with a JSON body and returns the user', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => fakeRes(200, { id: 'u1', email: 'a@b.c' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = await api.login('a@b.c');
    expect(user).toEqual({ id: 'u1', email: 'a@b.c' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/login');
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'a@b.c' });
    expect(init!.credentials).toBe('include');
  });

  it('throws ApiError with the server message on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeRes(401, { error: 'no session' })));
    await expect(api.me()).rejects.toMatchObject({ name: 'ApiError', status: 401, message: 'no session' });
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
  });

  it('builds export + download URLs without fetching', () => {
    expect(api.exportUrl('t1', 'md')).toBe('/api/tasks/t1/export?fmt=md');
    expect(api.workspaceDownloadUrl('a b.md', 2)).toBe('/api/workspace/file?path=a%20b.md&version=2&download=1');
    expect(api.taskEventsUrl('t1')).toBe('/api/tasks/t1/events');
  });

  it('encodes query params for workspace reads', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => fakeRes(200, { path: 'a/b.md', mime: 'text/markdown', version: 1, size: 1, content: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    await api.workspaceFile('a/b.md', 3);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/workspace/file?path=a%2Fb.md&version=3');
  });
});
