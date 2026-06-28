import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApi, ApiError } from './api';
import { fakeFacade } from '../test/setup';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('extension api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the Bearer token + configured base from chrome.storage', async () => {
    const facade = fakeFacade({ apiBase: 'https://bff.example', apiToken: 'apolla_x_y' });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => fakeRes(200, { id: 'u', email: 'a@b.c' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApi(facade);
    expect((await api.me()).email).toBe('a@b.c');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://bff.example/api/auth/me');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer apolla_x_y' });
  });

  it('defaults the base to localhost:3000 and omits auth when no token', async () => {
    const facade = fakeFacade({});
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => fakeRes(200, { id: 'u', email: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    await createApi(facade).me();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/api/auth/me');
    expect((init as RequestInit).headers).not.toHaveProperty('authorization');
  });

  it('throws ApiError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeRes(401, { error: 'no' })));
    await expect(createApi(fakeFacade({ apiToken: 't' })).me()).rejects.toBeInstanceOf(ApiError);
  });
});
