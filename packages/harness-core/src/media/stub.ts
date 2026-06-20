import type { MediaJob, MediaAsset, MediaCaps } from '@apolla/contracts';
import type { MediaAdapter, MediaCost, PollResult } from './types';

/** A deterministic SVG "image" data-URI rendering the prompt — visible, offline, reproducible. */
function svgDataUri(text: string, w = 1024, h = 1024, bg = '#1f2937'): string {
  const safe = text.replace(/[<>&]/g, '').slice(0, 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="50%" fill="#fff" font-family="system-ui" font-size="36" text-anchor="middle" dominant-baseline="middle">${safe}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Built-in deterministic media provider — the offline default and eval/CI fixture (the media
 * analogue of MockAdapter / StubSearchProvider). Models the async lifecycle: submit → ready.
 */
export class StubMediaAdapter implements MediaAdapter {
  readonly provider = 'stub';
  private readonly jobs = new Map<string, { job: MediaJob }>();
  private seq = 0;

  capabilities(): MediaCaps {
    return {
      kinds: ['image', 'video'],
      maxResolution: '1024x1024',
      maxDurationSec: 10,
      aspectRatios: ['1:1', '16:9', '9:16'],
      referenceImage: true,
    };
  }

  estimateCost(job: MediaJob): MediaCost {
    return { usd: job.kind === 'video' ? 0.2 : 0.01 };
  }

  async submit(_modelId: string, job: MediaJob): Promise<{ jobId: string }> {
    this.seq += 1;
    const jobId = `stub_${this.seq}`;
    this.jobs.set(jobId, { job });
    return { jobId };
  }

  async poll(jobId: string): Promise<PollResult> {
    const entry = this.jobs.get(jobId);
    if (!entry) return { status: 'failed', error: 'unknown job' };
    return { status: 'ready', assets: this.assetsFor(jobId, entry.job) };
  }

  async fetchResult(jobId: string): Promise<MediaAsset[]> {
    const entry = this.jobs.get(jobId);
    return entry ? this.assetsFor(jobId, entry.job) : [];
  }

  private assetsFor(jobId: string, job: MediaJob): MediaAsset[] {
    if (job.kind === 'video') {
      return [
        {
          id: `${jobId}_v`,
          kind: 'video',
          mime: 'video/mp4',
          uri: `stub://video/${jobId}.mp4`,
          width: 1280,
          height: 720,
          durationSec: 5,
          posterUri: svgDataUri(`▶ ${job.prompt}`, 1280, 720, '#0f172a'),
        },
      ];
    }
    return [
      {
        id: `${jobId}_i`,
        kind: 'image',
        mime: 'image/svg+xml',
        uri: svgDataUri(job.prompt),
        width: 1024,
        height: 1024,
      },
    ];
  }
}
