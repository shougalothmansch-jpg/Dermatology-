import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';
import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { db } from '../../db/db';
import type { AnkiNotetype, MediaFile, Question, Topic } from '../../db/types';
import { newSrs } from '../sm2';
import { nowIso, uid } from '../utils';
import { readFields, pbNumber, pbString } from './protobuf';
import { answerOnly, clozeNumbers, renderTemplate, stripHtml } from './template';

export interface ImportProgress {
  phase: 'reading' | 'cards' | 'saving' | 'media' | 'done';
  message: string;
  done?: number;
  total?: number;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  mediaFiles: number;
  decks: string[];
  topicsCreated: number;
  topicsMatched: number;
}

interface ParsedTemplate {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
}
interface ParsedNotetype {
  id: string;
  name: string;
  isCloze: boolean;
  css: string;
  fields: string[]; // by ord
  templates: ParsedTemplate[];
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => b.length > 4 && ZSTD_MAGIC.every((x, i) => b[i] === x);
const maybeZstd = (b: Uint8Array) => (isZstd(b) ? zstdDecompress(b) : b);
const utf8 = new TextDecoder();

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
};
export const mimeFor = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Streams through the zip once. `want(name)` decides which entries to read;
 * completed entries are handed to `onFile`, which may be async — we await it
 * between reads so memory stays bounded even for multi-hundred-MB decks.
 */
async function streamZip(
  file: File,
  want: (name: string) => boolean,
  onFile: (name: string, data: Uint8Array) => Promise<void> | void,
  onBytes?: (read: number) => void,
) {
  const pending: { name: string; data: Uint8Array }[] = [];
  let error: unknown = null;
  const uz = new Unzip((f: UnzipFile) => {
    if (!want(f.name)) return; // not started → data skipped
    const chunks: Uint8Array[] = [];
    f.ondata = (err, chunk, final) => {
      if (err) {
        error = err;
        return;
      }
      if (chunk?.length) chunks.push(chunk);
      if (final) pending.push({ name: f.name, data: concat(chunks) });
    };
    f.start();
  });
  uz.register(UnzipInflate);
  const reader = file.stream().getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      uz.push(new Uint8Array(0), true);
    } else {
      read += value.length;
      uz.push(value);
    }
    if (error) throw error;
    while (pending.length) {
      const p = pending.shift()!;
      await onFile(p.name, p.data);
    }
    onBytes?.(read);
    if (done) break;
  }
}

/** Returns zip entry name → media file name. */
function parseMediaMap(raw: Uint8Array): Map<string, string> {
  const bytes = maybeZstd(raw);
  const map = new Map<string, string>();
  if (bytes[0] === 0x7b /* { */) {
    const obj = JSON.parse(utf8.decode(bytes)) as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) map.set(k, v);
    return map;
  }
  // newer packages: protobuf MediaEntries { repeated MediaEntry entries = 1 }
  const entries = readFields(bytes).get(1) ?? [];
  entries.forEach((e, i) => {
    if (!(e instanceof Uint8Array)) return;
    const f = readFields(e);
    const name = pbString(f, 1);
    const legacy = pbNumber(f, 255);
    if (name) map.set(String(legacy ?? i), name);
  });
  return map;
}

function rows<T extends Record<string, unknown>>(dbx: Database, sql: string): T[] {
  const res = dbx.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

function parseNotetypes(dbx: Database, importId: string): { notetypes: Map<number, ParsedNotetype>; decks: Map<number, string> } {
  const notetypes = new Map<number, ParsedNotetype>();
  const decks = new Map<number, string>();
  const hasNewSchema = rows(dbx, "SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'").length > 0;

  if (hasNewSchema) {
    for (const r of rows<{ id: number; name: string; config: Uint8Array }>(dbx, 'SELECT id, name, config FROM notetypes')) {
      const cfg = readFields(r.config ?? new Uint8Array());
      notetypes.set(Number(r.id), {
        id: `${importId}:${r.id}`,
        name: r.name,
        isCloze: pbNumber(cfg, 1) === 1,
        css: pbString(cfg, 3),
        fields: [],
        templates: [],
      });
    }
    for (const r of rows<{ ntid: number; ord: number; name: string }>(dbx, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord')) {
      notetypes.get(Number(r.ntid))?.fields.splice(Number(r.ord), 0, r.name);
    }
    for (const r of rows<{ ntid: number; ord: number; name: string; config: Uint8Array }>(dbx, 'SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord')) {
      const cfg = readFields(r.config ?? new Uint8Array());
      notetypes.get(Number(r.ntid))?.templates.push({ name: r.name, ord: Number(r.ord), qfmt: pbString(cfg, 1), afmt: pbString(cfg, 2) });
    }
    for (const r of rows<{ id: number; name: string }>(dbx, 'SELECT id, name FROM decks')) {
      decks.set(Number(r.id), String(r.name).split('\x1f').join('::'));
    }
  } else {
    const col = rows<{ models: string; decks: string }>(dbx, 'SELECT models, decks FROM col')[0];
    if (!col) throw new Error('This file does not look like an Anki collection.');
    const models = JSON.parse(col.models) as Record<string, { name: string; type: number; css: string; flds: { name: string; ord: number }[]; tmpls: { name: string; ord: number; qfmt: string; afmt: string }[] }>;
    for (const [id, m] of Object.entries(models)) {
      notetypes.set(Number(id), {
        id: `${importId}:${id}`,
        name: m.name,
        isCloze: m.type === 1,
        css: m.css ?? '',
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
        templates: m.tmpls.map((t) => ({ name: t.name, ord: t.ord, qfmt: t.qfmt, afmt: t.afmt })),
      });
    }
    for (const [id, d] of Object.entries(JSON.parse(col.decks) as Record<string, { name: string }>)) decks.set(Number(id), d.name);
  }
  return { notetypes, decks };
}

interface BuiltCard {
  cardId: number;
  noteId: number;
  notetypeId: string;
  deck: string;
  front: string;
  back: string;
  tags: string[];
}

function buildCards(dbx: Database, notetypes: Map<number, ParsedNotetype>, decks: Map<number, string>): BuiltCard[] {
  const out: BuiltCard[] = [];
  const stmt = dbx.prepare('SELECT c.id AS cid, c.nid AS nid, c.did AS did, c.odid AS odid, c.ord AS ord, n.mid AS mid, n.flds AS flds, n.tags AS tags FROM cards c JOIN notes n ON n.id = c.nid ORDER BY c.nid, c.ord');
  try {
    while (stmt.step()) {
      const r = stmt.getAsObject() as { cid: number; nid: number; did: number; odid: number; ord: number; mid: number; flds: string; tags: string };
      const nt = notetypes.get(Number(r.mid));
      if (!nt) continue;
      const values = String(r.flds).split('\x1f');
      const fields: Record<string, string> = {};
      nt.fields.forEach((name, i) => (fields[name] = values[i] ?? ''));
      const ord = Number(r.ord);
      const tmpl = nt.isCloze ? nt.templates[0] : nt.templates.find((t) => t.ord === ord);
      if (!tmpl) continue;
      if (nt.isCloze && !clozeNumbers(values).includes(ord + 1)) continue;
      const deck = decks.get(Number(r.odid) || Number(r.did)) ?? 'Default';
      const tags = String(r.tags).trim();
      const base = { fields, clozeOrd: ord + 1, tags, deck, cardName: tmpl.name };
      const front = renderTemplate(tmpl.qfmt, { ...base, side: 'q' });
      const back = answerOnly(renderTemplate(tmpl.afmt, { ...base, side: 'a', frontSide: front }));
      if (!stripHtml(front) && !/<img/i.test(front)) continue; // empty card
      out.push({ cardId: Number(r.cid), noteId: Number(r.nid), notetypeId: nt.id, deck, front, back, tags: tags ? tags.split(/\s+/) : [] });
    }
  } finally {
    stmt.free();
  }
  return out;
}

// ---------- topic matching ----------

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

/** Assign each deck to a syllabus topic: match the deepest subdeck name to an existing topic, else create one. */
async function resolveTopics(deckNames: string[]): Promise<{ map: Map<string, string>; created: number; matched: number }> {
  const topics = await db.topics.toArray();
  // only match against topics that existed before this import, never ones it creates
  const syllabus = [...topics];
  const sections = await db.sections.orderBy('order').toArray();
  const map = new Map<string, string>();
  let created = 0;
  let matched = 0;
  const createdByName = new Map<string, Topic>();

  const findTopic = (name: string): Topic | undefined => {
    const n = norm(name);
    if (!n) return undefined;
    return (
      syllabus.find((t) => norm(t.name) === n) ??
      syllabus.find((t) => n.length >= 5 && (norm(t.name).startsWith(n) || n.startsWith(norm(t.name)))) ??
      syllabus.find((t) => n.length >= 6 && norm(t.name).includes(n))
    );
  };

  for (const deck of deckNames) {
    const parts = deck.split('::').map((p) => p.trim()).filter(Boolean);
    let topic: Topic | undefined;
    for (let i = parts.length - 1; i >= 1 && !topic; i--) topic = findTopic(parts[i]);
    if (!topic && parts.length === 1) topic = findTopic(parts[0]);
    if (topic) {
      matched++;
      map.set(deck, topic.id);
      continue;
    }
    // create under an "Anki: <root deck>" section
    const root = parts[0] ?? 'Anki';
    const leaf = parts.length > 1 ? parts.slice(1).join(' › ') : root;
    const key = `${root}\u0000${leaf}`;
    let t = createdByName.get(key);
    if (!t) {
      const sectionName = `Anki: ${root}`;
      let section = sections.find((s) => s.name === sectionName);
      if (!section) {
        section = { id: uid(), name: sectionName, order: sections.length };
        sections.push(section);
        await db.sections.add(section);
      }
      t = {
        id: uid(),
        sectionId: section.id,
        name: leaf,
        order: topics.filter((x) => x.sectionId === section!.id).length,
        chapters: {},
        status: 'Not started',
        confidence: 0,
        notes: '',
        updatedAt: nowIso(),
      };
      topics.push(t);
      createdByName.set(key, t);
      await db.topics.add(t);
      created++;
    }
    map.set(deck, t.id);
  }
  return { map, created, matched };
}

// ---------- main entry points ----------

export async function importAnkiPackage(file: File, onProgress: (p: ImportProgress) => void): Promise<ImportResult> {
  const importId = uid().slice(0, 8);
  const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

  // Pass 1: collection + media map (media data skipped)
  onProgress({ phase: 'reading', message: 'Reading deck…', done: 0, total: file.size });
  const collections: Record<string, Uint8Array> = {};
  let mediaMap = new Map<string, string>();
  await streamZip(
    file,
    (n) => n.startsWith('collection.') || n === 'media',
    (name, data) => {
      if (name === 'media') mediaMap = parseMediaMap(data);
      else collections[name] = data;
    },
    (read) => onProgress({ phase: 'reading', message: `Reading deck… ${mb(read)} of ${mb(file.size)}`, done: read, total: file.size }),
  );
  const colBytes = collections['collection.anki21b'] ?? collections['collection.anki21'] ?? collections['collection.anki2'];
  if (!colBytes) throw new Error('No Anki collection found in this file. Export from Anki as “Anki Deck Package (.apkg)”.');

  onProgress({ phase: 'cards', message: 'Opening collection…' });
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const dbx = new SQL.Database(maybeZstd(colBytes));
  let cards: BuiltCard[];
  let notetypes: Map<number, ParsedNotetype>;
  try {
    const parsed = parseNotetypes(dbx, importId);
    notetypes = parsed.notetypes;
    cards = buildCards(dbx, notetypes, parsed.decks);
  } finally {
    dbx.close();
  }
  if (!cards.length) throw new Error('No cards found. If you exported from a very new Anki version, try ticking “Support older Anki versions” when exporting.');

  // Topics
  const deckNames = [...new Set(cards.map((c) => c.deck))];
  const topics = await resolveTopics(deckNames);

  // Notetype CSS (reuse an identical stylesheet from an earlier import of the same deck)
  const usedNt = new Set(cards.map((c) => c.notetypeId));
  const existingNt = await db.ankiNotetypes.toArray();
  const ntRemap = new Map<string, string>();
  const ntRows: AnkiNotetype[] = [];
  for (const nt of notetypes.values()) {
    if (!usedNt.has(nt.id)) continue;
    const same = existingNt.find((e) => e.name === nt.name && e.css === nt.css);
    if (same) ntRemap.set(nt.id, same.id);
    else ntRows.push({ id: nt.id, name: nt.name, css: nt.css });
  }
  await db.ankiNotetypes.bulkPut(ntRows);

  // Save cards, updating ones imported before (matched by Anki card id)
  const existing = new Map<number, Question>();
  await db.questions.where('anki.cardId').anyOf(cards.map((c) => c.cardId)).each((q) => q.anki && existing.set(q.anki.cardId, q));
  let added = 0;
  let updated = 0;
  const BATCH = 400;
  const t0 = Date.now();
  for (let i = 0; i < cards.length; i += BATCH) {
    const now = nowIso();
    const batch = cards.slice(i, i + BATCH).map((c, j): Question => {
      const createdAt = new Date(t0 + i + j).toISOString();
      const anki = { cardId: c.cardId, noteId: c.noteId, notetypeId: ntRemap.get(c.notetypeId) ?? c.notetypeId, deck: c.deck, front: c.front, back: c.back };
      const prev = existing.get(c.cardId);
      if (prev) {
        updated++;
        return { ...prev, anki, stem: stripHtml(c.front).slice(0, 500), tags: c.tags, updatedAt: now };
      }
      added++;
      return {
        id: uid(),
        topicId: topics.map.get(c.deck)!,
        type: 'anki',
        stem: stripHtml(c.front).slice(0, 500),
        options: [],
        correctIndex: 0,
        answer: '',
        explanation: '',
        tags: c.tags,
        anki,
        createdAt,
        updatedAt: now,
        srs: newSrs(),
        attempts: 0,
        correct: 0,
      };
    });
    await db.questions.bulkPut(batch);
    onProgress({ phase: 'saving', message: `Saving cards… ${Math.min(i + BATCH, cards.length)} of ${cards.length}`, done: i + BATCH, total: cards.length });
  }

  // Pass 2: media files, written to the database as they stream in
  let mediaFiles = 0;
  if (mediaMap.size) {
    let buffer: MediaFile[] = [];
    let bufferBytes = 0;
    const flush = async () => {
      if (!buffer.length) return;
      await db.media.bulkPut(buffer);
      buffer = [];
      bufferBytes = 0;
    };
    await streamZip(
      file,
      (n) => mediaMap.has(n),
      async (zipName, data) => {
        const name = mediaMap.get(zipName)!;
        const bytes = maybeZstd(data);
        buffer.push({ name, blob: new Blob([bytes], { type: mimeFor(name) }) });
        bufferBytes += bytes.length;
        mediaFiles++;
        if (buffer.length >= 25 || bufferBytes > 8 * 1048576) await flush();
      },
      (read) => onProgress({ phase: 'media', message: `Saving images… ${mediaFiles} of ${mediaMap.size}`, done: read, total: file.size }),
    );
    await flush();
  }

  onProgress({ phase: 'done', message: 'Done' });
  return { added, updated, skipped: 0, mediaFiles, decks: deckNames, topicsCreated: topics.created, topicsMatched: topics.matched };
}

/** Anki “Notes in Plain Text” export: tab-separated front/back (text only, no images). */
export async function importAnkiText(file: File, onProgress: (p: ImportProgress) => void): Promise<ImportResult> {
  onProgress({ phase: 'reading', message: 'Reading file…' });
  const text = await file.text();
  let sep = '\t';
  let deckCol = -1;
  let tagsCol = -1;
  const rowsOut: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) {
      const [k, v] = line.slice(1).split(':');
      if (k === 'separator') sep = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ' }[v?.trim() ?? ''] ?? sep;
      if (k === 'deck column') deckCol = Number(v) - 1;
      if (k === 'tags column') tagsCol = Number(v) - 1;
      continue;
    }
    if (!line.trim()) continue;
    rowsOut.push(line.split(sep).map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"')));
  }
  const deckOf = (r: string[]) => (deckCol >= 0 ? r[deckCol] : file.name.replace(/\.(txt|tsv|csv)$/i, ''));
  const deckNames = [...new Set(rowsOut.map(deckOf))];
  const topics = await resolveTopics(deckNames);
  const now = nowIso();
  const qs: Question[] = rowsOut
    .filter((r) => r.length >= 2)
    .map((r) => {
      const content = r.filter((_, i) => i !== deckCol && i !== tagsCol);
      const front = content[0];
      const back = content.slice(1).join('<br>');
      return {
        id: uid(),
        topicId: topics.map.get(deckOf(r))!,
        type: 'anki',
        stem: stripHtml(front).slice(0, 500),
        options: [],
        correctIndex: 0,
        answer: '',
        explanation: '',
        tags: tagsCol >= 0 ? r[tagsCol].split(/\s+/).filter(Boolean) : [],
        anki: { cardId: 0, noteId: 0, notetypeId: '', deck: deckOf(r), front, back },
        createdAt: now,
        updatedAt: now,
        srs: newSrs(),
        attempts: 0,
        correct: 0,
      };
    });
  await db.questions.bulkAdd(qs);
  onProgress({ phase: 'done', message: 'Done' });
  return { added: qs.length, updated: 0, skipped: 0, mediaFiles: 0, decks: deckNames, topicsCreated: topics.created, topicsMatched: topics.matched };
}
