/**
 * End-to-end encryption for sync. Keys are derived on the device from the
 * username + passphrase (PBKDF2-SHA256, 600k iterations); the passphrase never
 * leaves the device and the server only receives ciphertext.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface SyncKeys {
  aes: CryptoKey; // AES-GCM 256, non-extractable
  vault: string; // 32 hex chars — which vault on the server
  auth: string; // 64 hex chars — proves we may read/write it
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const normalizeUser = (u: string) => u.trim().toLowerCase();

export async function deriveKeys(user: string, passphrase: string): Promise<SyncKeys> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`derm-path-sync:v1:${normalizeUser(user)}`), iterations: 600_000 },
      base,
      512,
    ),
  );
  const aes = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const mac = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  bits.fill(0);
  const vault = hex(await crypto.subtle.sign('HMAC', mac, enc.encode('vault-id'))).slice(0, 32);
  const auth = hex(await crypto.subtle.sign('HMAC', mac, enc.encode('auth-token')));
  return { aes, vault, auth };
}

// ---- compression (smaller uploads; Anki card HTML compresses well) ----

const canCompress = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// ---- base64 for large buffers ----

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Serialises, compresses (where supported) and encrypts. Format: base64(version | iv | ciphertext). */
export async function seal(aes: CryptoKey, value: unknown): Promise<string> {
  let plain = enc.encode(JSON.stringify(value));
  let version = 0;
  if (canCompress) {
    plain = await pipe(plain, new CompressionStream('gzip'));
    version = 1;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plain));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = version;
  out.set(iv, 1);
  out.set(ct, 13);
  return toB64(out);
}

/** Decrypts what `seal` produced. Throws if the key is wrong or data was altered. */
export async function open<T = unknown>(aes: CryptoKey, b64: string): Promise<T> {
  const raw = fromB64(b64);
  const version = raw[0];
  const iv = raw.subarray(1, 13);
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, raw.subarray(13)));
  if (version === 1) plain = await pipe(plain, new DecompressionStream('gzip'));
  return JSON.parse(dec.decode(plain)) as T;
}
