/**
 * Swappable speech capability (S19): ASR (transcribe) + TTS (synthesize) — Stub offline / OpenAI in
 * prod, same capability-as-config pattern as the LLM/media/search/payment/auth adapters. Audio is
 * bytes in/out; transcription text is UNTRUSTED data (it only fills an input the user submits).
 */
export interface SpeechProvider {
  readonly name: string;
  transcribe(audio: Uint8Array, opts: { mime: string; lang?: string }): Promise<{ text: string; durationMs?: number }>;
  synthesize(text: string, opts?: { voice?: string }): Promise<{ bytes: Uint8Array; mime: string }>;
}
