import type { MediaJob, MediaAsset, MediaCaps } from '@apolla/contracts';
import type { MediaAdapter, MediaCost, MediaCallOpts, PollResult } from '@apolla/harness-core';

const DEFAULT_BASE = 'https://api.seedance.example/v2';

export interface SeedanceOptions {
  baseUrl?: string;
}

/**
 * Seedance 2.0 video MediaAdapter — genuinely async (videos take minutes). submit() POSTs a
 * generation task and returns its id; poll() GETs the task status until ready, then returns the
 * video asset + poster. Endpoint/payload shapes are configurable (SEEDANCE_BASE_URL) and follow a
 * create-task/poll-task convention; confirm exact field names against the live API at provisioning.
 */
export class SeedanceVideoAdapter implements MediaAdapter {
  readonly provider = 'seedance';
  private readonly baseUrl: string;

  constructor(opts: SeedanceOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.SEEDANCE_BASE_URL ?? DEFAULT_BASE;
  }

  static isConfigured(): boolean {
    return !!process.env.SEEDANCE_API_KEY;
  }

  capabilities(): MediaCaps {
    return {
      kinds: ['video'],
      maxResolution: '1080p',
      maxDurationSec: 12,
      aspectRatios: ['16:9', '9:16', '1:1'],
      referenceImage: true,
    };
  }

  estimateCost(job: MediaJob): MediaCost {
    const seconds = typeof job.params.duration === 'number' ? job.params.duration : 5;
    return { usd: Number((seconds * 0.05).toFixed(4)) };
  }

  private headers(opts: MediaCallOpts): Record<string, string> {
    return { Authorization: `Bearer ${opts.apiKey ?? process.env.SEEDANCE_API_KEY}`, 'Content-Type': 'application/json' };
  }

  async submit(modelId: string, job: MediaJob, opts: MediaCallOpts): Promise<{ jobId: string }> {
    if (job.kind !== 'video') throw new Error('SeedanceVideoAdapter only supports video jobs');
    const res = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: this.headers(opts),
      body: JSON.stringify({
        model: modelId,
        prompt: job.prompt,
        reference_image: job.referenceImageUrl,
        duration: job.params.duration ?? 5,
        aspect_ratio: job.params.aspectRatio ?? '16:9',
        resolution: job.params.resolution ?? '720p',
      }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`Seedance ${res.status}: ${await res.text().catch(() => '')}`);
    const data: any = await res.json();
    const jobId = data?.id ?? data?.task_id;
    if (!jobId) throw new Error('Seedance returned no task id');
    return { jobId: String(jobId) };
  }

  async poll(jobId: string): Promise<PollResult> {
    const res = await fetch(`${this.baseUrl}/tasks/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${process.env.SEEDANCE_API_KEY}` },
    });
    if (!res.ok) return { status: 'failed', error: `Seedance ${res.status}` };
    const data: any = await res.json();
    const status = String(data?.status ?? 'processing');
    if (status === 'succeeded' || status === 'ready') {
      return { status: 'ready', assets: this.toAssets(jobId, data) };
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', error: data?.error ?? 'generation failed' };
    }
    return { status: 'processing' };
  }

  async fetchResult(jobId: string): Promise<MediaAsset[]> {
    const r = await this.poll(jobId);
    return r.assets ?? [];
  }

  private toAssets(jobId: string, data: any): MediaAsset[] {
    const out = data?.output ?? data?.result ?? {};
    const uri = out.video_url ?? out.url;
    if (!uri) return [];
    return [
      {
        id: `${jobId}_v`,
        kind: 'video',
        mime: 'video/mp4',
        uri: String(uri),
        durationSec: typeof out.duration === 'number' ? out.duration : undefined,
        posterUri: out.poster_url ?? out.thumbnail_url,
      },
    ];
  }
}
