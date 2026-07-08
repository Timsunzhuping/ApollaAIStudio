import { createHash } from 'node:crypto';
import type { SpeechProvider, TranscriptChunk } from './types';

const MARKER = 'STUBSPEECH:';

/**
 * Offline, deterministic speech provider for demo/CI. synthesize() embeds the text in the audio blob
 * and transcribe() decodes it, so a synthesize→transcribe round-trip recovers the text; arbitrary
 * audio transcribes to a stable hash-derived string. No network, no real audio codec.
 */
export class StubSpeechProvider implements SpeechProvider {
  readonly name = 'stub';

  async transcribe(audio: Uint8Array, _opts: { mime: string; lang?: string }): Promise<{ text: string; durationMs?: number }> {
    const buf = Buffer.from(audio);
    const s = buf.toString('utf8');
    if (s.startsWith(MARKER)) return { text: s.slice(MARKER.length), durationMs: 1000 };
    const h = createHash('sha256').update(buf).digest('hex').slice(0, 8);
    return { text: `transcribed audio ${h}`, durationMs: buf.length };
  }

  async synthesize(text: string, _opts?: { voice?: string }): Promise<{ bytes: Uint8Array; mime: string }> {
    return { bytes: new Uint8Array(Buffer.from(MARKER + text, 'utf8')), mime: 'audio/wav' };
  }

  /** Deterministic pseudo-streaming: reveal the transcript word by word, then a final chunk. */
  async *transcribeStream(audio: Uint8Array, opts: { mime: string; lang?: string }): AsyncIterable<TranscriptChunk> {
    const { text } = await this.transcribe(audio, opts);
    const words = text.split(' ');
    let acc = '';
    for (let i = 0; i < words.length; i++) {
      acc = acc ? `${acc} ${words[i]}` : words[i]!;
      yield { text: acc, done: i === words.length - 1 };
    }
    if (words.length === 0) yield { text: '', done: true };
  }
}
