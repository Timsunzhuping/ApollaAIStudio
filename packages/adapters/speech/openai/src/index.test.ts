import { describe, it, expect, vi } from 'vitest';
import { OpenAiSpeechProvider } from './index';

describe('OpenAiSpeechProvider (S19)', () => {
  it('transcribes via Whisper (multipart) and maps the text', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain('/audio/transcriptions');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer k');
      expect(init?.body).toBeInstanceOf(FormData);
      return { ok: true, status: 200, json: async () => ({ text: 'hello there' }) } as Response;
    }) as unknown as typeof fetch;
    const p = new OpenAiSpeechProvider({ apiKey: 'k', fetchFn });
    expect((await p.transcribe(new Uint8Array([1, 2, 3]), { mime: 'audio/webm' })).text).toBe('hello there');
  });

  it('synthesizes via TTS and returns audio bytes', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain('/audio/speech');
      const body = JSON.parse(String(init?.body)) as { input: string; voice: string };
      expect(body.input).toBe('read me');
      expect(body.voice).toBe('nova');
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([9, 9]).buffer } as Response;
    }) as unknown as typeof fetch;
    const p = new OpenAiSpeechProvider({ apiKey: 'k', fetchFn });
    const out = await p.synthesize('read me', { voice: 'nova' });
    expect(out.bytes.length).toBe(2);
    expect(out.mime).toBe('audio/mpeg');
  });
});
