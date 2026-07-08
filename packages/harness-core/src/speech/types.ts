/**
 * Swappable speech capability (S19): ASR (transcribe) + TTS (synthesize) — Stub offline / OpenAI in
 * prod, same capability-as-config pattern as the LLM/media/search/payment/auth adapters. Audio is
 * bytes in/out; transcription text is UNTRUSTED data (it only fills an input the user submits).
 */
/** One incremental transcription update (S32): the best transcript so far; `done` marks the final. */
export interface TranscriptChunk {
  text: string;
  done: boolean;
}

export interface SpeechProvider {
  readonly name: string;
  transcribe(audio: Uint8Array, opts: { mime: string; lang?: string }): Promise<{ text: string; durationMs?: number }>;
  synthesize(text: string, opts?: { voice?: string }): Promise<{ bytes: Uint8Array; mime: string }>;
  /**
   * Optional streaming transcription (S32): yields a growing transcript so the UI can show words as
   * they arrive instead of waiting for the whole clip. Providers without native streaming ASR (e.g.
   * Whisper is batch) can omit this; `streamTranscription` falls back to a single `transcribe`.
   */
  transcribeStream?(audio: Uint8Array, opts: { mime: string; lang?: string }): AsyncIterable<TranscriptChunk>;
}

/** Server-side helper: stream from any provider (native stream, else one `transcribe` → final chunk). */
export async function* streamTranscription(
  provider: SpeechProvider,
  audio: Uint8Array,
  opts: { mime: string; lang?: string },
): AsyncIterable<TranscriptChunk> {
  if (provider.transcribeStream) {
    yield* provider.transcribeStream(audio, opts);
    return;
  }
  const { text } = await provider.transcribe(audio, opts);
  yield { text, done: true };
}
