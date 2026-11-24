/**
 * A content fingerprint for a PDF: the same file gives the same id on every
 * device, so synced topics and quotes can point at "this book" everywhere.
 * Uses the size plus the first and last 1 MB, so even a huge book is cheap to hash.
 */
const SAMPLE = 1024 * 1024;

export async function fingerprintFrom(size: number, readRange: (from: number, to: number) => Promise<Uint8Array>): Promise<string> {
  const head = await readRange(0, Math.min(size, SAMPLE));
  const tail = await readRange(Math.max(0, size - SAMPLE), size);
  const sizeBytes = new TextEncoder().encode(`${size}:`);
  const all = new Uint8Array(sizeBytes.length + head.length + tail.length);
  all.set(sizeBytes, 0);
  all.set(head, sizeBytes.length);
  all.set(tail, sizeBytes.length + head.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return 'pdf-' + [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function fingerprintFile(file: Blob): Promise<string> {
  return fingerprintFrom(file.size, async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer()));
}
