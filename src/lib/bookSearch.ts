import { db } from '../db/db';
import type { BookFile, Question, Topic } from '../db/types';
import { stripHtml } from './anki/template';

// ---------------------------------------------------------------------------
// Background text indexing: saves each PDF page's text once, so quotes can be
// found instantly later. Runs one PDF at a time and resumes where it left off.
// ---------------------------------------------------------------------------

let running = false;
const listeners = new Set<() => void>();
export const onIndexProgress = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export async function indexPendingPdfs(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { openStoredPdf, pageText } = await import('./pdf');
    for (;;) {
      const next = (await db.pdfs.toArray()).find((f) => f.hasText && (f.indexedPages ?? 0) < f.pageCount);
      if (!next) break;
      let file: BookFile = next;
      // reopen periodically so pdf.js can release memory on long books
      while ((file.indexedPages ?? 0) < file.pageCount) {
        const doc = await openStoredPdf(file);
        try {
          const start = (file.indexedPages ?? 0) + 1;
          const stop = Math.min(file.pageCount, start + 149);
          let batch: { fileId: string; page: number; text: string }[] = [];
          for (let p = start; p <= stop; p++) {
            batch.push({ fileId: file.id, page: p, text: await pageText(doc, p) });
            if (batch.length === 10 || p === stop) {
              if (!(await db.pdfs.get(file.id))) return; // PDF was removed meanwhile
              await db.transaction('rw', [db.pdfPages, db.pdfs], async () => {
                await db.pdfPages.bulkPut(batch);
                await db.pdfs.update(file.id, { indexedPages: p });
              });
              batch = [];
              file = { ...file, indexedPages: p };
              listeners.forEach((l) => l());
            }
          }
        } finally {
          await doc.destroy();
        }
      }
    }
  } catch (e) {
    console.error('Indexing stopped', e);
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// Search: finds the sentences in your books that best match a question.
// ---------------------------------------------------------------------------

const STOP = new Set(
  ('the and for are with that this from which what when where who whom whose why how was were has have had not but can may might ' +
    'will would should could into onto than then them they their there these those its also most more less least such very each ' +
    'other some any all both only over under about after before between during within without upon via per one two three ' +
    'following true false best likely correct answer question patient patients year old presents presenting shows show seen ' +
    'commonly common usually typically often associated diagnosis feature features finding findings clinical case').split(' '),
);

function stem(w: string) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function terms(text: string): string[] {
  return (text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w))
    .map(stem);
}

/** Text that represents what the question tests: the answer side counts double. */
function questionText(q: Question): { question: string; answer: string } {
  if (q.type === 'anki' && q.anki) {
    const front = stripHtml(q.anki.front);
    const back = stripHtml(q.anki.back);
    return { question: front, answer: back.replace(front, '') };
  }
  if (q.type === 'mcq') return { question: q.stem, answer: `${q.options[q.correctIndex] ?? ''} ${q.explanation}` };
  return { question: q.stem, answer: `${q.answer} ${q.explanation}` };
}

export interface BookMatch {
  fileId: string;
  page: number;
  quote: string;
  score: number;
}

const SENT_RE = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/g;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .match(SENT_RE)
    ?.map((s) => s.trim())
    .filter((s) => s.length >= 20) ?? [];
}

const cache = new Map<string, BookMatch[]>();
export const clearMatchCache = () => cache.clear();

/**
 * Best matching passages across your books for a question. Searches the topic's
 * chapter pages first; if nothing good is found there, searches every indexed page.
 * Returns the best match per book (best overall first).
 */
export async function findBookMatches(q: Question, topic?: Topic, opts: { everywhere?: boolean; limit?: number } = {}): Promise<BookMatch[]> {
  const key = `${q.id}:${q.updatedAt}:${opts.everywhere ? 1 : 0}:${JSON.stringify(topic?.pages ?? [])}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { question, answer } = questionText(q);
  const weights = new Map<string, number>();
  const answerTerms = new Set(terms(answer));
  for (const t of terms(question)) weights.set(t, Math.max(weights.get(t) ?? 0, 1));
  for (const t of answerTerms) weights.set(t, (weights.get(t) ?? 0) + 2);
  if (!weights.size) return [];
  const qTerms = [...weights.keys()];

  const scopes = !opts.everywhere && topic?.pages?.length ? topic.pages : null;
  const pages: { fileId: string; page: number; text: string; counts: number[] }[] = [];
  const df = new Array(qTerms.length).fill(0);
  const scan = (row: { fileId: string; page: number; text: string }) => {
    const lower = row.text.toLowerCase();
    let any = false;
    const counts = qTerms.map((t, i) => {
      let c = 0;
      for (let at = lower.indexOf(t); at !== -1 && c < 20; at = lower.indexOf(t, at + t.length)) c++;
      if (c) {
        df[i]++;
        any = true;
      }
      return c;
    });
    if (any) pages.push({ ...row, counts });
  };
  if (scopes) {
    for (const s of scopes) await db.pdfPages.where('[fileId+page]').between([s.fileId, s.from], [s.fileId, s.to], true, true).each(scan);
  } else {
    await db.pdfPages.each(scan);
  }
  const total = Math.max(1, pages.length);
  const idf = df.map((d) => Math.log(1 + total / (1 + d)));

  const scored = pages
    .map((p) => ({ p, s: p.counts.reduce((acc, c, i) => acc + (c ? weights.get(qTerms[i])! * idf[i] * (1 + Math.log(c)) : 0), 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);

  const answerPhrase = answer.toLowerCase().replace(/\s+/g, ' ').trim();
  const out: BookMatch[] = [];
  for (const { p } of scored) {
    const sents = sentences(p.text);
    sents.forEach((sent, i) => {
      const st = new Set(terms(sent));
      let s = 0;
      let answerHits = 0;
      let hits = 0;
      qTerms.forEach((t, k) => {
        if (st.has(t)) {
          s += weights.get(t)! * idf[k];
          hits++;
          if (answerTerms.has(t)) answerHits++;
        }
      });
      // must share an answer word, or at least two words with the question — otherwise it isn't really about this
      if (!answerHits && hits < 2) return;
      if (answerPhrase.length >= 4 && answerPhrase.length <= 80 && sent.toLowerCase().includes(answerPhrase)) s *= 1.5;
      s /= Math.sqrt(Math.max(8, st.size) / 8); // don't favour very long sentences
      // include the following sentence when this one is short, for context
      const quote = sent.length < 90 && sents[i + 1] ? `${sent} ${sents[i + 1]}` : sent;
      out.push({ fileId: p.fileId, page: p.page, quote, score: s });
    });
  }
  out.sort((a, b) => b.score - a.score);

  // keep the best few, preferring different books
  const files = await db.pdfs.bulkGet([...new Set(out.map((m) => m.fileId))]);
  const bookOf = new Map(files.filter(Boolean).map((f) => [f!.id, f!.textbookId]));
  const seenBooks = new Set<string>();
  const result: BookMatch[] = [];
  for (const m of out) {
    const book = bookOf.get(m.fileId) ?? m.fileId;
    if (seenBooks.has(book)) continue;
    seenBooks.add(book);
    result.push(m);
    if (result.length >= (opts.limit ?? 3)) break;
  }
  // and a few runner-ups for "show another match"
  for (const m of out) {
    if (result.length >= (opts.limit ?? 3) + 5) break;
    if (!result.includes(m) && !result.some((r) => r.fileId === m.fileId && r.page === m.page && r.quote === m.quote)) result.push(m);
  }

  // weak match in the topic's chapter → try everywhere
  if (scopes && (!result.length || result[0].score < 1.5)) {
    const wide = await findBookMatches(q, topic, { ...opts, everywhere: true });
    cache.set(key, wide);
    return wide;
  }
  cache.set(key, result);
  return result;
}
