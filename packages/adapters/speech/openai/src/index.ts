import type { SpeechProvider } from '@apolla/harness-core';

const DEFAULT_BASE = 'https://api.openai.com/v1';

export interface OpenAiSpeechOptions {
  apiKey?: string;
  baseUrl?: string;
  asrModel?: string;
  ttsModel?: string;
  voice?: string;
  fetchFn?: typeof fetch;
}

/**
 * OpenAI SpeechProvider (S19): Whisper for ASR (`/audio/transcriptions`) + OpenAI TTS
 * (`/audio/speech`). fetch-based, no SDK, env-gated. Audio bytes are sent/received directly and are
 * never logged.
 */
export class OpenAiSpeechProvider implements SpeechProvider {
  readonly name = 'openai';
  private readonly key: string;
  private readonly base: string;
  private readonly asrModel: string;
  private readonly ttsModel: string;
  private readonly voice: string;
  private readonly fetch: typeof fetch;

  constructor(opts: OpenAiSpeechOptions = {}) {
    this.key = opts.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.base = opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE;
    this.asrModel = opts.asrModel ?? process.env.OPENAI_ASR_MODEL ?? 'whisper-1';
    this.ttsModel = opts.ttsModel ?? process.env.OPENAI_TTS_MODEL ?? 'tts-1';
    this.voice = opts.voice ?? process.env.OPENAI_TTS_VOICE ?? 'alloy';
    this.fetch = opts.fetchFn ?? fetch;
  }

  static isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async transcribe(audio: Uint8Array, opts: { mime: string; lang?: string }): Promise<{ text: string; durationMs?: number }> {
    const form = new FormData();
    const ext = (opts.mime.split('/')[1] ?? 'webm').split(';')[0];
    form.append('file', new Blob([audio], { type: opts.mime }), `audio.${ext}`);
    form.append('model', this.asrModel);
    if (opts.lang) form.append('language', opts.lang);
    const res = await this.fetch(`${this.base}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}` },
      body: form,
    });
    if (!res.ok) throw new Error(`OpenAI transcribe ${res.status}`);
    const json = (await res.json()) as { text?: string };
    return { text: String(json.text ?? '') };
  }

  async synthesize(text: string, opts?: { voice?: string }): Promise<{ bytes: Uint8Array; mime: string }> {
    const res = await this.fetch(`${this.base}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.ttsModel, input: text, voice: opts?.voice ?? this.voice, response_format: 'mp3' }),
    });
    if (!res.ok) throw new Error(`OpenAI synthesize ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, mime: 'audio/mpeg' };
  }
}
