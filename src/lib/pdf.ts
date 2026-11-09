import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { db } from '../db/db';
import type { BookFile } from '../db/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

type ReadRange = (begin: number, end: number) => Promise<Uint8Array>;

async function openRanged(length: number, read: ReadRange): Promise<PDFDocumentProxy> {
  const initial = await read(0, Math.min(length, 256 * 1024));
  const transport = new pdfjs.PDFDataRangeTransport(length, initial);
  transport.requestDataRange = (begin: number, end: number) => {
    read(begin, end)
      .then((buf) => transport.onDataRange(begin, buf))
      .catch((e) => console.error('PDF read failed', e));
  };
  return pdfjs.getDocument({
    range: transport,
    length,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 256 * 1024,
    isEvalSupported: false,
  }).promise;
}

/** Opens a PDF from a Blob/File (e.g. straight from the file picker), reading only the ranges pdf.js asks for. */
export function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  return openRanged(blob.size, async (b, e) => new Uint8Array(await blob.slice(b, e).arrayBuffer()));
}

/**
 * Opens a PDF saved on this device in chunks. Only the chunks pdf.js needs are
 * read, and at most a few are kept in memory, so even a whole textbook stays
 * light on iPhone memory.
 */
export function openStoredPdf(file: Pick<BookFile, 'id' | 'size' | 'chunkSize'>): Promise<PDFDocumentProxy> {
  const cache = new Map<number, Uint8Array>();
  const MAX_CACHED = 4;
  const chunk = async (i: number): Promise<Uint8Array> => {
    const hit = cache.get(i);
    if (hit) {
      cache.delete(i);
      cache.set(i, hit); // mark as recently used
      return hit;
    }
    const row = await db.pdfChunks.get([file.id, i]);
    if (!row) throw new Error('Part of this PDF is missing on this device. Remove it and add it again.');
    const data = new Uint8Array(row.data);
    cache.set(i, data);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    return data;
  };
  return openRanged(file.size, async (begin, end) => {
    const out = new Uint8Array(end - begin);
    for (let i = Math.floor(begin / file.chunkSize); i * file.chunkSize < end; i++) {
      const data = await chunk(i);
      const cStart = i * file.chunkSize;
      const from = Math.max(begin, cStart) - cStart;
      const to = Math.min(end, cStart + data.length) - cStart;
      out.set(data.subarray(from, to), cStart + from - begin);
    }
    return out;
  });
}

/** Plain text of one page (1-based), with line breaks where the PDF has them. */
export async function pageText(doc: PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await doc.getPage(pageNum);
  const content = await page.getTextContent();
  let out = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
    else if (item.str && !item.str.endsWith(' ')) out += ' ';
  }
  page.cleanup();
  return reflow(out.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
}

/**
 * Joins lines that the PDF wrapped mid-sentence (next line starts in lower case),
 * and re-joins words hyphenated across lines. Headings and paragraph ends stay put.
 */
export function reflow(text: string): string {
  return text
    .replace(/([a-z])-\n([a-z])/g, '$1$2')
    .replace(/([^.:;!?\n])\n(?=[a-z(,])/g, '$1 ');
}

/** Text of a page range with [Page N] markers, for AI question generation. */
export async function rangeText(doc: PDFDocumentProxy, from: number, to: number, onPage?: (n: number) => void): Promise<{ text: string; pages: Map<number, string> }> {
  const pages = new Map<number, string>();
  const parts: string[] = [];
  for (let p = from; p <= to; p++) {
    const t = await pageText(doc, p);
    pages.set(p, t);
    parts.push(`[Page ${p}]\n${t}`);
    onPage?.(p);
  }
  return { text: parts.join('\n\n'), pages };
}

/** True if any of the first few pages has selectable text (i.e. not a scanned image-only PDF). */
export async function detectText(doc: PDFDocumentProxy): Promise<boolean> {
  const n = Math.min(doc.numPages, 8);
  for (let p = 1; p <= n; p++) if ((await pageText(doc, p)).replace(/\s/g, '').length > 40) return true;
  return false;
}

export const normalizeForMatch = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // ignore hyphens entirely: PDFs split words at line ends and reflow may re-join them
    .replace(/[‐-―-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Does the quote appear (allowing for whitespace/hyphenation differences) in the page text? */
export function quoteFound(quote: string, page: string): boolean {
  const q = normalizeForMatch(quote);
  return q.length > 0 && normalizeForMatch(page).includes(q);
}
