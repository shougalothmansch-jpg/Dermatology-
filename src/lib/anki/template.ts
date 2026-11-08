/**
 * A small implementation of Anki's card template language:
 * {{Field}}, {{FrontSide}}, {{#Field}}…{{/Field}}, {{^Field}}…{{/Field}},
 * filters (cloze, text, hint, type, …), and cloze deletions.
 */

export interface RenderContext {
  fields: Record<string, string>;
  /** 1-based cloze number for cloze note types; ignored otherwise */
  clozeOrd: number;
  side: 'q' | 'a';
  frontSide?: string;
  tags: string;
  deck: string;
  cardName: string;
}

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function renderCloze(text: string, ord: number, side: 'q' | 'a'): string {
  return text.replace(CLOZE_RE, (_m, n: string, body: string, hint?: string) => {
    if (Number(n) !== ord) return body;
    if (side === 'q') return `<span class="cloze">[${hint ? escapeHtml(hint) : '...'}]</span>`;
    return `<span class="cloze">${body}</span>`;
  });
}

/** Cloze numbers used in a field set, e.g. {{c1::…}} {{c3::…}} → [1, 3] */
export function clozeNumbers(fieldValues: string[]): number[] {
  const set = new Set<number>();
  for (const v of fieldValues) for (const m of v.matchAll(CLOZE_RE)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fieldValue(name: string, ctx: RenderContext): string {
  switch (name) {
    case 'FrontSide':
      return ctx.side === 'a' ? ctx.frontSide ?? '' : '';
    case 'Tags':
      return ctx.tags;
    case 'Deck':
      return ctx.deck;
    case 'Subdeck':
      return ctx.deck.split('::').pop() ?? '';
    case 'Card':
      return ctx.cardName;
    case 'Type':
      return '';
    default:
      return ctx.fields[name] ?? '';
  }
}

function applyFilters(raw: string, filters: string[], ctx: RenderContext): string {
  let v = raw;
  // Anki applies filters right-to-left: {{text:cloze:Field}}
  for (const f of [...filters].reverse()) {
    const name = f.trim().toLowerCase();
    if (name === 'cloze') v = renderCloze(v, ctx.clozeOrd, ctx.side);
    else if (name === 'cloze-only') {
      const parts: string[] = [];
      for (const m of v.matchAll(CLOZE_RE)) if (Number(m[1]) === ctx.clozeOrd) parts.push(m[2]);
      v = parts.join(', ');
    } else if (name === 'text') v = escapeHtml(stripHtml(v));
    else if (name === 'hint') v = v.trim() ? `<details class="hint"><summary>Show hint</summary>${v}</details>` : '';
    else if (name === 'type' || name.startsWith('tts')) v = '';
    // furigana / kana / kanji and unknown filters: pass through unchanged
  }
  return v;
}

function isNonEmpty(name: string, ctx: RenderContext): boolean {
  return stripHtml(fieldValue(name, ctx)).trim().length > 0 || /<img/i.test(fieldValue(name, ctx));
}

export function renderTemplate(template: string, ctx: RenderContext): string {
  // conditional sections, innermost first, repeated until stable
  let t = template;
  const sectionRe = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
  for (let guard = 0; guard < 500; guard++) {
    const m = sectionRe.exec(t);
    if (!m) break;
    const [whole, kind, rawName, inner] = m;
    const name = rawName.split(':').pop()!.trim();
    const keep = kind === '#' ? isNonEmpty(name, ctx) : !isNonEmpty(name, ctx);
    t = t.slice(0, m.index) + (keep ? inner : '') + t.slice(m.index + whole.length);
  }
  // replacements
  t = t.replace(/\{\{\s*([^#^/{}][^{}]*?)\s*\}\}/g, (_m, expr: string) => {
    const parts = expr.split(':');
    const name = parts.pop()!.trim();
    return applyFilters(fieldValue(name, ctx), parts, ctx);
  });
  // drop audio references
  return t.replace(/\[sound:[^\]]+\]/g, '');
}

/** Anki's answer side usually contains the question followed by <hr id=answer>. Keep only what follows. */
export function answerOnly(backHtml: string): string {
  const m = /<hr[^>]*id=["']?answer["']?[^>]*>/i.exec(backHtml);
  return m ? backHtml.slice(m.index + m[0].length) : backHtml;
}
