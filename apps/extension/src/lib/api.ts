import { readConfig, type ChromeFacade } from './chrome';
import { streamSSE } from './sse';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface User { id: string; email: string }

/** Bearer-token API client for the BFF (base + token from chrome.storage via the facade). */
export function createApi(facade: ChromeFacade) {
  async function authHeaders(json = false): Promise<Record<string, string>> {
    const { token } = await readConfig(facade);
    return { ...(json ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
  }
  async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { base } = await readConfig(facade);
    const res = await fetch(base + path, { method, headers: await authHeaders(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, detail.error ?? res.statusText);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    me: () => http<User>('GET', '/api/auth/me'),
    createTask: (question: string) => http<{ taskId: string }>('POST', '/api/tasks', { question }),
    runSurface: (surfaceId: string, text: string, params: Record<string, unknown> = {}) =>
      http<{ path: string; version: number; structured?: unknown }>('POST', '/api/surface', { surfaceId, text, params }),
    saveArtifact: (path: string, content: string) => http<{ path: string; version: number }>('POST', '/api/workspace/save-artifact', { path, content }),
    /** Stream a task's research events via SSE-over-fetch (carries the Bearer token). */
    async streamTask(taskId: string, onEvent: (e: { type: string } & Record<string, unknown>) => void): Promise<void> {
      const { base } = await readConfig(facade);
      await streamSSE(`${base}/api/tasks/${taskId}/events`, { method: 'GET', headers: await authHeaders() }, onEvent);
    },
  };
}

export type ExtensionApi = ReturnType<typeof createApi>;
