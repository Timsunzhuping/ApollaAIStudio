import { describe, it, expect } from 'vitest';
import { StubSpeechProvider } from './stub';
import { streamTranscription, type SpeechProvider, type TranscriptChunk } from './types';

const enc = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
async function collect(it: AsyncIterable<TranscriptChunk>): Promise<TranscriptChunk[]> {
  const out: TranscriptChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('StubSpeechProvider (S19)', () => {
  const p = new StubSpeechProvider();

  it('round-trips synthesize → transcribe', async () => {
    const { bytes, mime } = await p.synthesize('research the EV market');
    expect(bytes.length).toBeGreaterThan(0);
    expect(mime).toContain('audio/');
    expect((await p.transcribe(bytes, { mime })).text).toBe('research the EV market');
  });

  it('transcribes arbitrary audio deterministically', async () => {
    const a = await p.transcribe(enc('rawbytes'), { mime: 'audio/webm' });
    const b = await p.transcribe(enc('rawbytes'), { mime: 'audio/webm' });
    expect(a.text).toBe(b.text); // same audio → same transcript
    expect(a.text).not.toBe((await p.transcribe(enc('other'), { mime: 'audio/webm' })).text);
  });

  it('streams a growing transcript, last chunk marked done (S32)', async () => {
    const { bytes, mime } = await p.synthesize('one two three');
    const chunks = await collect(p.transcribeStream(bytes, { mime }));
    expect(chunks.map((c) => c.text)).toEqual(['one', 'one two', 'one two three']);
    expect(chunks.at(-1)!.done).toBe(true);
    expect(chunks.slice(0, -1).every((c) => !c.done)).toBe(true);
  });

  it('streamTranscription falls back to one final chunk for a non-streaming provider', async () => {
    const oneShot: SpeechProvider = {
      name: 'oneshot',
      transcribe: async () => ({ text: 'hello world' }),
      synthesize: async () => ({ bytes: new Uint8Array(), mime: 'audio/wav' }),
    };
    const chunks = await collect(streamTranscription(oneShot, enc('x'), { mime: 'audio/webm' }));
    expect(chunks).toEqual([{ text: 'hello world', done: true }]);
  });
});
