/**
 * Derm Path sync service (Netlify Function + Netlify Blobs).
 *
 * Everything stored here is encrypted on the user's device before upload; the
 * server only ever sees opaque ciphertext. A "vault" is identified by a random-
 * looking id derived from the user's passphrase, and each request must carry an
 * access token (also derived from the passphrase) whose SHA-256 is stored once.
 *
 * Layout in the "derm-sync" store:
 *   <vault>/meta                     { authHash, created }
 *   <vault>/d/log/<ts>-<rand>        an encrypted batch of changed records
 *   <vault>/d/snap/<id>/<part>       an encrypted full snapshot, in parts
 *   <vault>/d/snap/<id>/done         marks a complete snapshot
 */
import { getStore } from '@netlify/blobs';

export const config = { path: '/api/sync' };

const MAX_BODY = 4_500_000; // stay under the 6 MB function payload limit
const HEX32 = /^[a-f0-9]{32}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const DATA_KEY = /^(log\/\d{13}-[a-z0-9]{6}|snap\/\d{13}-[a-z0-9]{6}\/(\d{1,4}|done))$/;
const SNAP_ID = /^\d{13}-[a-z0-9]{6}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const stamp = () => `${String(Date.now()).padStart(13, '0')}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;

export async function handle(req, store) {
  const url = new URL(req.url);
  const action = url.searchParams.get('a') ?? '';
  const vault = req.headers.get('x-vault') ?? '';
  const auth = req.headers.get('x-auth') ?? '';
  if (!HEX32.test(vault) || !HEX64.test(auth)) return json({ error: 'bad-credentials' }, 400);

  const metaKey = `${vault}/meta`;
  const authHash = await sha256(auth);
  const meta = await store.get(metaKey, { type: 'json' });

  if (action === 'hello') {
    const create = url.searchParams.get('create') === '1';
    if (!meta) {
      if (!create) return json({ error: 'no-vault' }, 404);
      await store.setJSON(metaKey, { authHash, created: Date.now() });
      return json({ ok: true, created: true });
    }
    if (meta.authHash !== authHash) return json({ error: 'forbidden' }, 403);
    return json({ ok: true, created: false });
  }

  if (!meta) return json({ error: 'no-vault' }, 404);
  if (meta.authHash !== authHash) return json({ error: 'forbidden' }, 403);
  const prefix = `${vault}/d/`;

  switch (action) {
    case 'list': {
      const { blobs } = await store.list({ prefix });
      return json({ keys: blobs.map((b) => b.key.slice(prefix.length)).sort() });
    }
    case 'get': {
      const key = url.searchParams.get('key') ?? '';
      if (!DATA_KEY.test(key)) return json({ error: 'bad-key' }, 400);
      const text = await store.get(prefix + key, { type: 'text' });
      if (text === null) return json({ error: 'not-found' }, 404);
      return new Response(text, { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
    }
    case 'put': {
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      const body = await req.text();
      if (!body || body.length > MAX_BODY) return json({ error: 'too-large' }, 413);
      const kind = url.searchParams.get('kind');
      let key;
      if (kind === 'log') key = `log/${stamp()}`;
      else if (kind === 'snap') {
        const part = url.searchParams.get('part') ?? '';
        let id = url.searchParams.get('snap') ?? '';
        if (!/^\d{1,4}$/.test(part)) return json({ error: 'bad-part' }, 400);
        if (part === '0' && !id) id = stamp();
        if (!SNAP_ID.test(id)) return json({ error: 'bad-snap' }, 400);
        key = `snap/${id}/${part}`;
      } else if (kind === 'snapdone') {
        const id = url.searchParams.get('snap') ?? '';
        if (!SNAP_ID.test(id)) return json({ error: 'bad-snap' }, 400);
        key = `snap/${id}/done`;
      } else return json({ error: 'bad-kind' }, 400);
      await store.set(prefix + key, body);
      return json({ ok: true, key });
    }
    case 'delete': {
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      const { keys } = JSON.parse((await req.text()) || '{}');
      if (!Array.isArray(keys) || keys.length > 2000 || !keys.every((k) => typeof k === 'string' && DATA_KEY.test(k))) return json({ error: 'bad-keys' }, 400);
      for (const k of keys) await store.delete(prefix + k);
      return json({ ok: true, deleted: keys.length });
    }
    case 'erase': {
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      const { blobs } = await store.list({ prefix: `${vault}/` });
      for (const b of blobs) await store.delete(b.key);
      return json({ ok: true });
    }
    default:
      return json({ error: 'bad-action' }, 400);
  }
}

export default async (req) => {
  try {
    return await handle(req, getStore({ name: 'derm-sync', consistency: 'strong' }));
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
};
