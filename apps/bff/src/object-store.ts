import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ObjectStore } from '@apolla/harness-core';

/** Local-filesystem object store. Re-hosted media is written here and served at /media/<key>. */
export class LocalObjectStore implements ObjectStore {
  constructor(private readonly dir = process.env.MEDIA_DIR ?? path.join(os.tmpdir(), 'apolla-media')) {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private safe(key: string): string {
    return key.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  async put(key: string, bytes: Uint8Array, mime: string): Promise<{ uri: string }> {
    const name = this.safe(key);
    fs.writeFileSync(path.join(this.dir, name), Buffer.from(bytes));
    fs.writeFileSync(path.join(this.dir, `${name}.mime`), mime);
    return { uri: `/media/${name}` };
  }

  read(key: string): { bytes: Buffer; mime: string } | undefined {
    const name = this.safe(key);
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) return undefined;
    const mimeFile = `${file}.mime`;
    const mime = fs.existsSync(mimeFile) ? fs.readFileSync(mimeFile, 'utf8') : 'application/octet-stream';
    return { bytes: fs.readFileSync(file), mime };
  }
}
