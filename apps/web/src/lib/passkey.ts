import { api } from './api';

/**
 * Software passkeys (S33). A device-local P-256 keypair (WebCrypto) whose private key lives in
 * IndexedDB and never leaves the browser; the public key is registered with the server. Sign-in signs
 * a fresh server challenge (ES256 / IEEE-P1363) — protocol-compatible with the backend's verifier.
 *
 * NOTE: this is a *software* passkey (key in IndexedDB), not a hardware/platform authenticator, so it
 * lacks the OS-level origin binding of full WebAuthn. It's a real passwordless factor and the crypto
 * core is identical; upgrading to navigator.credentials + CTAP attestation is documented follow-up.
 * The signing key is generated non-extractable — usable but never readable.
 */
export function passkeySupported(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
}

const toB64url = (buf: ArrayBuffer): string => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Pluggable private-key store (IndexedDB in the app; overridable in tests). */
export interface KeyStore {
  put(id: string, key: CryptoKey): Promise<void>;
  get(id: string): Promise<CryptoKey | undefined>;
  ids(): Promise<string[]>;
  remove(id: string): Promise<void>;
}

const DB = 'apolla-passkeys';
const STORE = 'keys';
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const idbKeyStore: KeyStore = {
  async put(id, key) { const db = await openDb(); await new Promise<void>((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(key, id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  async get(id) { const db = await openDb(); return new Promise((res) => { const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(id); r.onsuccess = () => res(r.result as CryptoKey | undefined); r.onerror = () => res(undefined); }); },
  async ids() { const db = await openDb(); return new Promise((res) => { const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys(); r.onsuccess = () => res((r.result as IDBValidKey[]).map(String)); r.onerror = () => res([]); }); },
  async remove(id) { const db = await openDb(); await new Promise<void>((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); }); },
};

async function sign(privateKey: CryptoKey, challenge: string): Promise<string> {
  const data = new TextEncoder().encode(challenge);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
  return toB64url(sig); // WebCrypto ECDSA output is IEEE-P1363 (raw r||s) — matches the server verifier
}

/** Register a new passkey for the signed-in user. Persists the private key only after the server accepts. */
export async function registerPasskey(label = 'This device', store: KeyStore = idbKeyStore): Promise<{ id: string; label: string }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKey = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
  const credentialId = toB64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const { challenge } = await api.passkeyRegisterStart();
  const signature = await sign(kp.privateKey, challenge);
  const res = await api.passkeyRegisterFinish({ credentialId, publicKey, signature, challenge, label });
  await store.put(credentialId, kp.privateKey);
  return res;
}

/** Sign in with a passkey registered on this device for `email`. Throws if none match. */
export async function loginWithPasskey(email: string, store: KeyStore = idbKeyStore): Promise<void> {
  const { challenge, credentialIds } = await api.passkeyLoginStart(email);
  const local = new Set(await store.ids());
  const credentialId = credentialIds.find((id) => local.has(id));
  if (!credentialId) throw new Error('No passkey for this account on this device.');
  const key = await store.get(credentialId);
  if (!key) throw new Error('Passkey key missing on this device.');
  await api.passkeyLoginFinish({ credentialId, challenge, signature: await sign(key, challenge) });
}
