import { describe, it, expect } from 'vitest';
import { OpenAIImageAdapter } from './index';

const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.SMOKE_OPENAI_IMAGE_MODEL;

describe.skipIf(!KEY || !MODEL)('OpenAIImageAdapter (smoke)', () => {
  it('generates an image asset', async () => {
    const a = new OpenAIImageAdapter();
    const { jobId } = await a.submit(MODEL!, { kind: 'image', prompt: 'a red apple on a table', params: {} }, { apiKey: KEY! });
    const r = await a.poll(jobId);
    expect(r.status).toBe('ready');
    expect(r.assets?.[0]?.kind).toBe('image');
  });
});
