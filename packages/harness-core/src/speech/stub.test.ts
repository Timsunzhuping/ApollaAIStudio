import { describe, it, expect } from 'vitest';
import { StubSpeechProvider } from './stub';

const enc = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

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
});
