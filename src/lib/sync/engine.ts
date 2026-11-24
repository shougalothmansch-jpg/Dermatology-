/**
 * Encrypted sync between your devices.
 *
 * Each sync: pull (download + apply other devices' changes), push (upload this
 * device's changes), and occasionally compact (replace many small change files
 * with one snapshot). Everything uploaded is encrypted with a key derived from
 * your username + passphrase; the server sees only ciphertext.
 *
 * PDFs, their page text and Anki images are NOT synced (too large; add them on
 * each device). References to PDFs inside synced records use a content
 * fingerprint so they match up when the same PDF is added on another device.
 */
import { db, TABLE_NAMES } from '../../db/db';
import type { SyncHash } from '../../db/types';
import { fingerprintFrom } from '../pdfFingerprint';
import { deriveKeys, normalizeUser, open, seal } from './crypto';

export const SYNC_TABLES = TABLE_NAMES; // everything in the JSON backup
const API = `${import.meta.env.BASE_URL}api/sync`;
const BATCH_BYTES = 2_500_000; // plaintext per upload (compressed + encrypted it stays well under the server limit)
const COMPACT_AFTER = 40; // change files before making a snapshot
const LATE_WINDOW = 120_000; // re-check change files this much older than our cursor (server clock skew / slow writes)
const TOMBSTONE_DAYS = 90;

interface DeviceSync {
  id: 'sync';
  user: string;
  aes: CryptoKey;
  vault: string;
  auth: string;
  cursorTs?: number; // newest change file applied
  applied: string[]; // recent change-file keys already applied (or written by us)
  snapId?: string;
  lastSync?: string;
  lastError?: string;
}

interface Rec {
  t: string; // table
  k: string | number; // primary key
  at: number;
  del?: 1;
  v?: Record<string, unknown>;
}

export class SyncError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// status for the UI
// ---------------------------------------------------------------------------

export interface SyncStatus {
  enabled: boolean;
  user?: string;
  running: boolean;
  lastSync?: string;
  lastError?: string;
  message?: string;
}
let status: SyncStatus = { enabled: false, running: false };
const listeners = new Set<(s: SyncStatus) => void>();
const emit = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
};
export const getSyncStatus = () => status;
export function onSyncStatus(fn: (s: SyncStatus) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function loadState(): Promise<DeviceSync | undefined> {
  return (await db.device.get('sync')) as DeviceSync | undefined;
}
async function saveState(st: DeviceSync) {
  await db.device.put(st as unknown as { id: string });
}
export async function refreshStatus() {
  const st = await loadState();
  emit({ enabled: !!st, user: st?.user, lastSync: st?.lastSync, lastError: st?.lastError });
}

// ---------------------------------------------------------------------------
// server API
// ---------------------------------------------------------------------------

async function api(
  creds: { vault: string; auth: string },
  action: string,
  opts: { method?: 'GET' | 'POST'; params?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const qs = new URLSearchParams({ a: action, ...(opts.params ?? {}) });
  let res: Response;
  try {
    res = await fetch(`${API}?${qs}`, {
      method: opts.method ?? 'GET',
      headers: { 'x-vault': creds.vault, 'x-auth': creds.auth, ...(opts.body ? { 'content-type': 'text/plain' } : {}) },
      body: opts.body,
      cache: 'no-store',
    });
  } catch {
    throw new SyncError('Can’t reach the sync service — check your internet connection.', 'offline');
  }
  if (!res.ok) {
    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `http-${res.status}`;
    const msg =
      code === 'no-vault'
        ? 'No synced data found for this username and passphrase.'
        : code === 'forbidden'
          ? 'The sync service refused this device. Turn sync off and on again with your username and passphrase.'
          : code === 'too-large'
            ? 'A sync upload was too large.'
            : `Sync failed (${code}).`;
    throw new SyncError(msg, code);
  }
  return res;
}

// ---------------------------------------------------------------------------
// hashing + PDF id mapping
// ---------------------------------------------------------------------------

/** Fast 53-bit string hash (cyrb53) — only for spotting changes. */
function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const hashRow = (row: unknown) => hash(JSON.stringify(row));

const pkOf = (table: string) => db.table(table).schema.primKey.keyPath as string;

/** Local PDF id ↔ content fingerprint, computing fingerprints for older PDFs as needed. */
async function pdfIdMaps() {
  const out = new Map<string, string>();
  const inn = new Map<string, string>();
  for (const f of await db.pdfs.toArray()) {
    let fp = f.fingerprint;
    if (!fp) {
      const readRange = async (from: number, to: number) => {
        const buf = new Uint8Array(to - from);
        for (let i = Math.floor(from / f.chunkSize); i * f.chunkSize < to; i++) {
          const row = await db.pdfChunks.get([f.id, i]);
          if (!row) throw new Error('missing chunk');
          const data = new Uint8Array(row.data);
          const cStart = i * f.chunkSize;
          const a = Math.max(from, cStart) - cStart;
          const b = Math.min(to, cStart + data.length) - cStart;
          buf.set(data.subarray(a, b), cStart + a - from);
        }
        return buf;
      };
      try {
        fp = await fingerprintFrom(f.size, readRange);
        await db.pdfs.update(f.id, { fingerprint: fp });
      } catch {
        continue;
      }
    }
    if (fp !== f.id) {
      out.set(f.id, fp);
      inn.set(fp, f.id);
    }
  }
  return { out, inn };
}

type Row = Record<string, unknown>;
function remapFileIds(table: string, row: Row, map: Map<string, string>): Row {
  if (!map.size) return row;
  if (table === 'topics' && Array.isArray(row.pages)) {
    return { ...row, pages: (row.pages as { fileId: string }[]).map((p) => ({ ...p, fileId: map.get(p.fileId) ?? p.fileId })) };
  }
  if (table === 'questions' && row.source && typeof row.source === 'object') {
    const s = row.source as { fileId: string };
    return { ...row, source: { ...s, fileId: map.get(s.fileId) ?? s.fileId } };
  }
  return row;
}

// ---------------------------------------------------------------------------
// apply incoming records
// ---------------------------------------------------------------------------

async function applyRecords(recs: Rec[], inMap: Map<string, string>): Promise<number> {
  let applied = 0;
  const byTable = new Map<string, Rec[]>();
  for (const r of recs) if ((SYNC_TABLES as readonly string[]).includes(r.t)) byTable.set(r.t, [...(byTable.get(r.t) ?? []), r]);
  for (const [t, list] of byTable) {
    const table = db.table(t);
    // newest version per key wins within this batch
    const latest = new Map<string | number, Rec>();
    for (const r of list) if (!latest.has(r.k) || latest.get(r.k)!.at < r.at) latest.set(r.k, r);
    const keys = [...latest.keys()];
    const ids = keys.map((k) => `${t}:${k}`);
    await db.transaction('rw', [table, db.syncHashes], async () => {
      const [rows, hashes] = await Promise.all([table.bulkGet(keys as never[]), db.syncHashes.bulkGet(ids)]);
      const puts: Row[] = [];
      const dels: (string | number)[] = [];
      const newHashes: SyncHash[] = [];
      keys.forEach((k, i) => {
        const r = latest.get(k)!;
        const h = hashes[i];
        const row = rows[i] as Row | undefined;
        if (h && r.at <= h.at) return; // we already have this version or newer
        const localHash = row ? hashRow(row) : 'DEL';
        const locallyChanged = h ? localHash !== h.hash : !!row;
        if (locallyChanged) return; // an unsynced edit on this device wins; it is pushed next
        if (r.del) {
          if (row) dels.push(k);
          newHashes.push({ id: ids[i], hash: 'DEL', at: r.at });
        } else if (r.v) {
          const value = remapFileIds(t, r.v, inMap);
          puts.push(value);
          newHashes.push({ id: ids[i], hash: hashRow(value), at: r.at });
        }
        applied++;
      });
      if (dels.length) await table.bulkDelete(dels as never[]);
      if (puts.length) await table.bulkPut(puts as never[]);
      if (newHashes.length) await db.syncHashes.bulkPut(newHashes);
    });
  }
  return applied;
}

// ---------------------------------------------------------------------------
// local change detection
// ---------------------------------------------------------------------------

async function scanLocal(outMap: Map<string, string>) {
  const now = Date.now();
  const hashes = new Map((await db.syncHashes.toArray()).map((h) => [h.id, h]));
  const changes: Rec[] = [];
  const newHashes: SyncHash[] = [];
  const seen = new Set<string>();
  for (const t of SYNC_TABLES) {
    const pk = pkOf(t);
    await db.table(t).each((row: Row) => {
      const k = row[pk] as string | number;
      const id = `${t}:${k}`;
      seen.add(id);
      const h = hashRow(row);
      if (hashes.get(id)?.hash !== h) {
        changes.push({ t, k, at: now, v: remapFileIds(t, row, outMap) });
        newHashes.push({ id, hash: h, at: now });
      }
    });
  }
  const cutoff = now - TOMBSTONE_DAYS * 86400000;
  const expired: string[] = [];
  for (const [id, h] of hashes) {
    if (seen.has(id)) continue;
    if (h.hash === 'DEL') {
      if (h.at < cutoff) expired.push(id);
      continue;
    }
    const i = id.indexOf(':');
    // all synced tables use string primary keys
    changes.push({ t: id.slice(0, i), k: id.slice(i + 1), at: now, del: 1 });
    newHashes.push({ id, hash: 'DEL', at: now });
  }
  if (expired.length) await db.syncHashes.bulkDelete(expired);
  return { changes, newHashes };
}

function batches<T>(items: T[], size: (x: T) => number, max: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let n = 0;
  for (const it of items) {
    const s = size(it);
    if (cur.length && n + s > max) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(it);
    n += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

const tsOf = (id: string) => Number(id.slice(0, 13));

// ---------------------------------------------------------------------------
// one full sync
// ---------------------------------------------------------------------------

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const st = await loadState();
    if (!st) return;
    emit({ running: true, message: 'Syncing…' });
    try {
      const { out, inn } = await pdfIdMaps();

      // ---- pull ----
      const { keys } = (await (await api(st, 'list')).json()) as { keys: string[] };
      const done = keys.filter((k) => /^snap\/[^/]+\/done$/.test(k)).map((k) => k.split('/')[1]).sort();
      const latestSnap = done[done.length - 1];
      const applied = new Set(st.applied);
      let cursorTs = st.cursorTs ?? 0;
      if (latestSnap && st.snapId !== latestSnap && tsOf(latestSnap) > cursorTs) {
        // we may have missed change files that were folded into this snapshot
        const parts = keys
          .filter((k) => k.startsWith(`snap/${latestSnap}/`) && /\/\d+$/.test(k))
          .sort((a, b) => Number(a.split('/')[2]) - Number(b.split('/')[2]));
        for (const [i, key] of parts.entries()) {
          emit({ message: `Downloading snapshot ${i + 1}/${parts.length}…` });
          const recs = await open<Rec[]>(st.aes, await (await api(st, 'get', { params: { key } })).text());
          await applyRecords(recs, inn);
        }
        st.snapId = latestSnap;
        cursorTs = Math.max(cursorTs, tsOf(latestSnap) - LATE_WINDOW);
      }
      const logs = keys.filter((k) => k.startsWith('log/')).sort();
      const fresh = logs.filter((k) => tsOf(k.slice(4)) >= cursorTs - LATE_WINDOW && !applied.has(k));
      for (const [i, key] of fresh.entries()) {
        emit({ message: `Downloading changes ${i + 1}/${fresh.length}…` });
        const recs = await open<Rec[]>(st.aes, await (await api(st, 'get', { params: { key } })).text());
        await applyRecords(recs, inn);
        applied.add(key);
        cursorTs = Math.max(cursorTs, tsOf(key.slice(4)));
      }

      // ---- push ----
      const { changes, newHashes } = await scanLocal(out);
      const hashById = new Map(newHashes.map((h) => [h.id, h]));
      const groups = batches(changes, (r) => JSON.stringify(r).length, BATCH_BYTES);
      for (const [i, group] of groups.entries()) {
        emit({ message: `Uploading changes ${i + 1}/${groups.length}…` });
        const body = await seal(st.aes, group);
        const { key } = (await (await api(st, 'put', { method: 'POST', params: { kind: 'log' }, body })).json()) as { key: string };
        applied.add(key);
        logs.push(key);
        await db.syncHashes.bulkPut(group.map((r) => hashById.get(`${r.t}:${r.k}`)!));
      }

      // ---- compact ----
      if (logs.length > COMPACT_AFTER) {
        emit({ message: 'Tidying up…' });
        const foldable = logs.filter((k) => applied.has(k));
        const all: Rec[] = [];
        const hashes = new Map((await db.syncHashes.toArray()).map((h) => [h.id, h]));
        for (const t of SYNC_TABLES) {
          const pk = pkOf(t);
          await db.table(t).each((row: Row) => {
            const k = row[pk] as string | number;
            all.push({ t, k, at: hashes.get(`${t}:${k}`)?.at ?? Date.now(), v: remapFileIds(t, row, out) });
          });
        }
        for (const [id, h] of hashes) {
          if (h.hash !== 'DEL') continue;
          const i = id.indexOf(':');
          all.push({ t: id.slice(0, i), k: id.slice(i + 1), at: h.at, del: 1 });
        }
        const parts = batches(all, (r) => JSON.stringify(r).length, BATCH_BYTES);
        let snapId = '';
        for (const [i, part] of parts.entries()) {
          const body = await seal(st.aes, part);
          const res = (await (await api(st, 'put', { method: 'POST', params: { kind: 'snap', part: String(i), ...(snapId ? { snap: snapId } : {}) }, body })).json()) as { key: string };
          snapId = res.key.split('/')[1];
        }
        await api(st, 'put', { method: 'POST', params: { kind: 'snapdone', snap: snapId }, body: JSON.stringify({ parts: parts.length }) });
        const oldSnapKeys = keys.filter((k) => k.startsWith('snap/') && !k.startsWith(`snap/${snapId}/`));
        const toDelete = [...foldable.filter((k) => tsOf(k.slice(4)) < tsOf(snapId)), ...oldSnapKeys];
        for (let i = 0; i < toDelete.length; i += 1000) await api(st, 'delete', { method: 'POST', body: JSON.stringify({ keys: toDelete.slice(i, i + 1000) }) });
        st.snapId = snapId;
        toDelete.forEach((k) => applied.delete(k));
      }

      // remember only recent change files
      st.applied = [...applied].filter((k) => !k.startsWith('log/') || tsOf(k.slice(4)) >= cursorTs - 2 * LATE_WINDOW);
      st.cursorTs = cursorTs;
      st.lastSync = new Date().toISOString();
      st.lastError = undefined;
      await saveState(st);
      emit({ running: false, message: undefined, lastSync: st.lastSync, lastError: undefined, enabled: true, user: st.user });
    } catch (e) {
      const msg = e instanceof SyncError ? e.message : e instanceof Error && /decrypt|operation/i.test(e.name + e.message) ? 'Couldn’t decrypt synced data — the passphrase may be different on another device.' : 'Sync failed. It will try again later.';
      st.lastError = msg;
      await saveState(st).catch(() => undefined);
      emit({ running: false, message: undefined, lastError: msg });
      throw e;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

// ---------------------------------------------------------------------------
// setup / teardown
// ---------------------------------------------------------------------------

export type EnableResult = { status: 'ok' } | { status: 'exists' } | { status: 'not-found' };

/**
 * Turns sync on. `mode`:
 *  - 'first': create the synced copy from this device (if it already exists → returns 'exists')
 *  - 'join-replace': use the synced copy, replacing this device's study data
 *  - 'join-merge': combine this device's data with the synced copy
 */
export async function enableSync(user: string, passphrase: string, mode: 'first' | 'join-replace' | 'join-merge'): Promise<EnableResult> {
  emit({ message: 'Securing your key… (a few seconds)' });
  const keys = await deriveKeys(user, passphrase);
  const res = await fetch(`${API}?a=hello${mode === 'first' ? '&create=1' : ''}`, { headers: { 'x-vault': keys.vault, 'x-auth': keys.auth }, cache: 'no-store' }).catch(() => {
    throw new SyncError('Can’t reach the sync service — check your internet connection.', 'offline');
  });
  if (res.status === 404) {
    emit({ message: undefined });
    return { status: 'not-found' };
  }
  if (res.status === 403) throw new SyncError('This username is already used with a different passphrase.', 'forbidden');
  if (!res.ok) throw new SyncError('The sync service is not available right now.', `http-${res.status}`);
  const { created } = (await res.json()) as { created: boolean };
  if (mode === 'first' && !created) {
    emit({ message: undefined });
    return { status: 'exists' };
  }
  await db.syncHashes.clear();
  if (mode === 'join-replace') {
    await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async () => {
      for (const t of SYNC_TABLES) await db.table(t).clear();
    });
  }
  await saveState({ id: 'sync', user: normalizeUser(user), aes: keys.aes, vault: keys.vault, auth: keys.auth, applied: [] });
  emit({ enabled: true, user: normalizeUser(user) });
  await syncNow();
  return { status: 'ok' };
}

/** Stops syncing on this device. Data on this device and the synced copy are kept. */
export async function disableSync() {
  await db.device.delete('sync');
  await db.syncHashes.clear();
  emit({ enabled: false, user: undefined, lastSync: undefined, lastError: undefined });
}

/** Deletes the synced copy from the server, then turns sync off here. */
export async function eraseSyncedCopy() {
  const st = await loadState();
  if (st) await api(st, 'erase', { method: 'POST', body: '{}' });
  await disableSync();
}

// ---------------------------------------------------------------------------
// automatic syncing while the app is open
// ---------------------------------------------------------------------------

let started = false;
export function startAutoSync() {
  if (started) return;
  started = true;
  const tick = () => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) void syncNow().catch(() => undefined);
  };
  void refreshStatus().then(() => setTimeout(tick, 2500));
  setInterval(tick, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    // upload right away when leaving the app; download when coming back
    void syncNow().catch(() => undefined);
  });
  window.addEventListener('online', tick);
}
