import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

/**
 * Opens a PDF stored as a Blob, reading only the byte ranges pdf.js asks for.
 * This keeps memory low on iPhone even for a whole 1,000+ page textbook.
 */
export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const initialLen = Math.min(blob.size, 256 * 1024);
  const initial = new Uint8Array(await blob.slice(0, initialLen).arrayBuffer());
  const transport = new pdfjs.PDFDataRangeTransport(blob.size, initial);
  transport.requestDataRange = (begin: number, end: number) => {
    blob
      .slice(begin, end)
      .arrayBuffer()
      .then((buf) => transport.onDataRange(begin, new Uint8Array(buf)));
  };
  return pdfjs.getDocument({
    range: transport,
    length: blob.size,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 256 * 1024,
    isEvalSupported: false,
  }).promise;
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
