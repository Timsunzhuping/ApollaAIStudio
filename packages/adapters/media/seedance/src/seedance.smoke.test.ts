import { describe, it, expect } from 'vitest';
import { SeedanceVideoAdapter } from './index';

const KEY = process.env.SEEDANCE_API_KEY;
const MODEL = process.env.SMOKE_SEEDANCE_MODEL;

describe.skipIf(!KEY || !MODEL)('SeedanceVideoAdapter (smoke)', () => {
  it('submits a video task and polls to a terminal state', async () => {
    const a = new SeedanceVideoAdapter();
    const { jobId } = await a.submit(
      MODEL!,
      { kind: 'video', prompt: 'a short explainer about electric vehicles', params: { duration: 5 } },
      { apiKey: KEY! },
    );
    let r = await a.poll(jobId);
    for (let i = 0; i < 60 && r.status === 'processing'; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      r = await a.poll(jobId);
    }
    expect(['ready', 'failed']).toContain(r.status);
  }, 600_000);
});
