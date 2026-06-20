import { z } from 'zod';

/**
 * Media logical aliases. Business code uses ONLY these — never raw media model ids.
 * The alias→provider/model mapping lives in @apolla/config (media-routes.json). See PRD §13.2.
 */
export const MediaAlias = z.enum(['image_fast', 'image_premium', 'video_standard', 'video_premium']);
export type MediaAlias = z.infer<typeof MediaAlias>;

export const MediaKind = z.enum(['image', 'video']);
export type MediaKind = z.infer<typeof MediaKind>;

/** Routing entry for one media alias (validated by @apolla/config). */
export const MediaRouteConfig = z.object({
  alias: MediaAlias,
  primary: z.string(),
  fallbackChain: z.array(z.string()).default([]),
  keyPool: z.array(z.string()).default([]),
});
export type MediaRouteConfig = z.infer<typeof MediaRouteConfig>;

/** A generation request. `params` carries provider-agnostic options (aspectRatio, duration, …). */
export const MediaJob = z.object({
  kind: MediaKind,
  prompt: z.string(),
  /** image: ref/seed image; video: first-frame / reference image. */
  referenceImageUrl: z.string().optional(),
  params: z.record(z.any()).default({}),
});
export type MediaJob = z.infer<typeof MediaJob>;

/** A produced asset. `uri` points at our own object store (provider URIs are re-hosted). */
export const MediaAsset = z.object({
  id: z.string(),
  kind: MediaKind,
  mime: z.string(),
  uri: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
  posterUri: z.string().optional(),
});
export type MediaAsset = z.infer<typeof MediaAsset>;

/** A provider's declared capability matrix (drives routing + validation). */
export const MediaCaps = z.object({
  kinds: z.array(MediaKind),
  maxResolution: z.string().optional(),
  maxDurationSec: z.number().positive().optional(),
  aspectRatios: z.array(z.string()).default([]),
  referenceImage: z.boolean().default(false),
});
export type MediaCaps = z.infer<typeof MediaCaps>;

export const MediaJobStatus = z.enum(['submitted', 'processing', 'ready', 'failed']);
export type MediaJobStatus = z.infer<typeof MediaJobStatus>;

/** The async media task object — observable, billable, replayable, owner-scoped (PRD §13). */
export const MediaTask = z.object({
  id: z.string(),
  ownerId: z.string(),
  alias: MediaAlias,
  job: MediaJob,
  status: MediaJobStatus,
  assets: z.array(MediaAsset).default([]),
  costUsd: z.number().default(0),
  moderated: z.boolean().default(false),
  error: z.string().optional(),
  projectId: z.string().optional(),
  /** The research task this media was generated for (research→media chaining, S3-T9). */
  sourceTaskId: z.string().optional(),
  createdAt: z.string().optional(),
});
export type MediaTask = z.infer<typeof MediaTask>;
