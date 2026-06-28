import { StubSpeechProvider } from '@apolla/harness-core';
import type { CheckResult } from './checks';

/**
 * Speech (S19): the stub provider round-trips synthesize → transcribe and is deterministic for
 * arbitrary audio. Fully offline (no network, no codec).
 */
export async function speechRoundTrip(): Promise<CheckResult> {
  const issues: string[] = [];
  const p = new StubSpeechProvider();

  const { bytes, mime } = await p.synthesize('summarize the report');
  if (bytes.length === 0 || !mime.startsWith('audio/')) issues.push('synthesize produced no audio');
  const back = await p.transcribe(bytes, { mime });
  if (back.text !== 'summarize the report') issues.push('synthesize→transcribe did not round-trip');

  const raw = new Uint8Array(Buffer.from('some-audio', 'utf8'));
  const a = await p.transcribe(raw, { mime: 'audio/webm' });
  const b = await p.transcribe(raw, { mime: 'audio/webm' });
  if (a.text !== b.text) issues.push('transcribe is not deterministic for identical audio');

  return { name: 'speech-round-trip', ok: issues.length === 0, issues };
}

export async function runSpeechScenarios(): Promise<CheckResult[]> {
  return [await speechRoundTrip()];
}
