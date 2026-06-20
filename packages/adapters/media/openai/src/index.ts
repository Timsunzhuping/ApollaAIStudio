import type { MediaJob, MediaAsset, MediaCaps } from '@apolla/contracts';
import type { MediaAdapter, MediaCost, MediaCallOpts, PollResult } from '@apolla/harness-core';

const DEFAULT_BASE = 'https://api.openai.com/v1';

export interface OpenAIImageOptions {
  baseUrl?: string;
}

/**
 * OpenAI Images MediaAdapter (image only). The Images API is effectively synchronous, so submit()
 * performs the call and stores the result; poll() returns ready immediately. Re-hosting of the
 * returned URI into our object store happens in the MediaOrchestrator (S3-T4).
 */
export class OpenAIImageAdapter implements MediaAdapter {
  readonly provider = 'openai';
  private readonly baseUrl: string;
  private readonly results = new Map<string, MediaAsset[]>();
  private seq = 0;

  constructor(opts: OpenAIImageOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE;
  }

  static isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  capabilities(): MediaCaps {
    return { kinds: ['image'], maxResolution: '1024x1024', aspectRatios: ['1:1', '16:9', '9:16'], referenceImage: false };
  }

  estimateCost(_job: MediaJob): MediaCost {
    return { usd: 0.04 };
  }

  async submit(modelId: string, job: MediaJob, opts: MediaCallOpts): Promise<{ jobId: string }> {
    if (job.kind !== 'image') throw new Error('OpenAIImageAdapter only supports image jobs');
    const size = typeof job.params.size === 'string' ? job.params.size : '1024x1024';
    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey ?? process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, prompt: job.prompt, size, n: 1 }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`OpenAI images ${res.status}: ${await res.text().catch(() => '')}`);
    const data: any = await res.json();
    const item = data?.data?.[0] ?? {};
    const uri: string = item.url ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
    if (!uri) throw new Error('OpenAI images returned no asset');

    this.seq += 1;
    const jobId = `oai_${this.seq}`;
    this.results.set(jobId, [{ id: `${jobId}_i`, kind: 'image', mime: 'image/png', uri, width: 1024, height: 1024 }]);
    return { jobId };
  }

  async poll(jobId: string): Promise<PollResult> {
    const assets = this.results.get(jobId);
    return assets ? { status: 'ready', assets } : { status: 'failed', error: 'unknown job' };
  }

  async fetchResult(jobId: string): Promise<MediaAsset[]> {
    return this.results.get(jobId) ?? [];
  }
}
