import type { MediaAsset } from '@apolla/contracts';

/** Object storage boundary. Local FS / S3 impls slot in behind this (ARCHITECTURE infra layer). */
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<{ uri: string }>;
}

/** In-memory store — default for tests/offline. Returns a self-describing `mem://` uri. */
export class InMemoryObjectStore implements ObjectStore {
  private readonly objs = new Map<string, { bytes: Uint8Array; mime: string }>();
  constructor(private readonly base = 'mem://') {}

  async put(key: string, bytes: Uint8Array, mime: string): Promise<{ uri: string }> {
    this.objs.set(key, { bytes, mime });
    return { uri: `${this.base}${key}` };
  }

  get(key: string): { bytes: Uint8Array; mime: string } | undefined {
    return this.objs.get(key);
  }
}

type FetchLike = (url: string) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;

async function rehostUri(
  store: ObjectStore,
  key: string,
  uri: string,
  mime: string,
  fetchImpl: FetchLike,
): Promise<string> {
  // Provider http(s) URIs are temporary — re-host them. data:/stub:/mem: are self-contained.
  if (!/^https?:/i.test(uri)) return uri;
  const res = await fetchImpl(uri);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { uri: stored } = await store.put(key, bytes, mime);
  return stored;
}

/** Re-host an asset's media (and poster) into our own store, returning stable URIs. */
export async function rehostAsset(
  store: ObjectStore,
  asset: MediaAsset,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<MediaAsset> {
  const uri = await rehostUri(store, asset.id, asset.uri, asset.mime, fetchImpl);
  const posterUri = asset.posterUri
    ? await rehostUri(store, `${asset.id}_poster`, asset.posterUri, 'image/png', fetchImpl)
    : undefined;
  return { ...asset, uri, posterUri };
}
