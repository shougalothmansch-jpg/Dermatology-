/**
 * Free, offline question maker: turns fact-dense sentences from your own
 * textbook pages into fill-in-the-blank / multiple-choice questions.
 * No AI and no network — rules only, so quality varies; every question keeps
 * the exact book sentence as its source.
 */

export type TermKind = 'definition' | 'cause' | 'eponym' | 'gene' | 'number' | 'drug';

export interface AutoQuestion {
  page: number;
  sentence: string; // exact text from the page
  answer: string;
  kind: TermKind;
  stem: string; // sentence with the answer blanked
  options?: string[]; // MCQ options incl. answer (absent → short answer)
  correctIndex?: number;
  score: number;
}

const ABBREV = /\b(e\.g|i\.e|et al|etc|vs|approx|fig|figs|ref|refs|no|st|dr|mr|mrs|ca|cf|resp|incl|var|spp|sp|subsp|min|max|mo|yr|yrs|wk|wks)\.(?=\s)/gi;
const PLACEHOLDER = '․'; // one-dot leader, restored after splitting

export function splitSentences(text: string): string[] {
  const t = text
    .replace(/\s+/g, ' ')
    .replace(ABBREV, (m) => m.replace(/\./g, PLACEHOLDER))
    .replace(/\b([A-Z])\.(?=\s?[A-Z])/g, `$1${PLACEHOLDER}`); // initials
  return (t.match(/[^.!?]+[.!?]+(?=\s+[A-Z(\d"“]|\s*$)/g) ?? []).map((s) => s.replace(new RegExp(PLACEHOLDER, 'g'), '.').trim());
}

function usable(s: string): boolean {
  if (s.length < 50 || s.length > 300) return false;
  if (!/^[A-Z(“"]/.test(s)) return false; // fragments from page breaks
  if (/\b(fig(ure)?s?\.?|table|box|chapter|see also|reproduced|courtesy|copyright|©|isbn|www\.|http)/i.test(s)) return false;
  const letters = s.replace(/[^A-Za-z]/g, '').length;
  return letters / s.length > 0.6; // skip reference lists and number-heavy rows
}

const STARTERS = /^(the|this|these|those|it|its|they|there|such|both|however|in|on|of|for|with|as|at|by|an?|other|most|some|many|several|patients?|lesions?|treatment|therapy|diagnosis)$/i;
const NP_END = /[,;:()]|\s(is|are|was|were|has|have|may|can|which|that|who|and|or|but|in|on|with|of|from|to|by)\s/i;

// generic heads that make poor answers ("caused by mutations in X" — the answer is X, not "mutations")
const GENERIC = /^(mutations?|autoantibod\w*|antibod\w*|defects?|deficienc\w*|loss|lack|abnormalit\w*|changes?|increased|decreased|reduced|elevated|several|various|many|multiple|different|other|certain|unknown|exposure|infection|inflammation|damage|factors?|genes?|proteins?|disorders?|diseases?|conditions?)$/i;

function cleanNP(np: string): string | null {
  const t = np.trim().replace(/^(the|a|an)\s+/i, '').replace(/[.,;:]+$/, '');
  const words = t.split(/\s+/);
  if (!t || words.length > 5 || t.length < 3 || t.length > 50) return null;
  if (STARTERS.test(words[0]) || GENERIC.test(words[0])) return null;
  if (/^\d+$/.test(t)) return null;
  return t;
}

interface Candidate {
  answer: string;
  kind: TermKind;
  weight: number;
  keepAfter?: string; // e.g. " sign" stays in the stem after the blank
}

const EPONYM_NOUNS = 'sign|syndrome|disease|phenomenon|nevus|naevus|lines|striae|bodies|cells|test|criteria|spots|papules|nodules|patches|granules|stain|reaction';
const CUES = /\b(most common|most frequent|characteristic|pathognomonic|hallmark|typically|classic(ally)?|first[- ]line|treatment of choice|drug of choice|gold standard|associated with|caused by|due to|mutations? in|autoantibod|inherited|autosomal|x-linked|presents? with|diagnostic)\b/gi;

function candidates(s: string): Candidate[] {
  const out: Candidate[] = [];
  // Eponymous signs/syndromes: "The Auspitz sign is…"
  for (const m of s.matchAll(new RegExp(`\\b([A-Z][a-zà-ÿ'’]+(?:[-–][A-Z][a-zà-ÿ'’]+)?)\\s+(${EPONYM_NOUNS})\\b`, 'g'))) {
    if (!STARTERS.test(m[1])) out.push({ answer: m[1], kind: 'eponym', weight: 2.6 });
  }
  // Genes / proteins / cytokines: COL7A1, KRT14, BP180, IL-17A, CD30
  for (const m of s.matchAll(/\b(?:[A-Z]{2,6}\d{1,3}[A-Z]?\d*|[A-Z]{1,4}-\d{1,3}[A-Z]?|CD\d{1,3}|BP\d{3})\b/g)) {
    out.push({ answer: m[0], kind: 'gene', weight: 2.5 });
  }
  // Definitions: "<Term> is a/an/the …"
  const def = /^(?:The\s+)?([A-Z][^,;:()]{2,60}?)\s+(?:is|are|refers to|describes?)\s+(?:a|an|the|characteri[sz]ed|defined|caused|seen|usually|typically|most)\b/.exec(s);
  if (def) {
    const np = cleanNP(def[1]);
    if (np) out.push({ answer: np, kind: 'definition', weight: 3 });
  }
  // Causes / targets: "caused by X", "mutations in X", "antibodies against X", "targets X"
  for (const m of s.matchAll(/\b(?:caused by|due to|mutations? in(?: the)?|autoantibodies (?:against|to|target(?:ing)?)|antibodies (?:against|to)|target(?:s|ing)?|deficiency of|inherited as an?)\s+([^.]{3,70})/gi)) {
    const np = cleanNP(m[1].split(NP_END)[0]);
    if (np) out.push({ answer: np, kind: 'cause', weight: 3 });
  }
  // Treatments: "first-line … is X", "treatment of choice is X"
  const tx = /\b(?:first[- ]line (?:treatment|therapy)|treatment of choice|drug of choice)[^.]*?\b(?:is|are|include[s]?)\s+([^.]{3,60})/i.exec(s);
  if (tx) {
    const np = cleanNP(tx[1].split(NP_END)[0]);
    if (np) out.push({ answer: np, kind: 'drug', weight: 2.8 });
  }
  // Numbers: "2–3%", "40 years"
  for (const m of s.matchAll(/\b\d+(?:[.,]\d+)?(?:\s?[–-]\s?\d+(?:[.,]\d+)?)?\s?(?:%|percent|years?|months?|weeks?|days?)\b/g)) {
    out.push({ answer: m[0], kind: 'number', weight: 1.2 });
  }
  return out;
}

function blank(sentence: string, answer: string): string | null {
  const esc = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9])${esc}(?=[^A-Za-z0-9]|$)`, 'g');
  if (!re.test(sentence)) return null;
  return sentence.replace(re, (_m, pre: string) => `${pre}_____`);
}

function numberDistractors(answer: string): string[] {
  const m = /(\d+(?:[.,]\d+)?)(.*)$/.exec(answer);
  if (!m) return [];
  const n = parseFloat(m[1].replace(',', '.'));
  const suffix = answer.slice(m.index + m[1].length);
  if (/[–-]\s?\d/.test(suffix)) return []; // ranges: keep as short answer
  const set = new Set<string>();
  for (const f of [0.25, 0.5, 2, 3, 5]) {
    const v = n * f;
    const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    if (r > 0 && r !== n && (!answer.includes('%') || r <= 100)) set.add(`${r}${suffix}`);
  }
  return [...set];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Makes up to `count` questions from a chapter's pages.
 * `skipQuotes` — book sentences already used by existing questions.
 */
const GENE_RE = /^(?:[A-Z]{2,6}\d{1,3}[A-Z]?\d*|[A-Z]{1,4}-\d{1,3}[A-Z]?|CD\d{1,3}|BP\d{3})$/;

/**
 * Makes up to `count` questions from a chapter's pages.
 * `skipQuotes` — book sentences already used by existing questions.
 * `extra` — more plausible wrong answers by kind (e.g. other disease names from the syllabus).
 */
export function makeQuestions(
  pages: { page: number; text: string }[],
  count: number,
  skipQuotes: Set<string> = new Set(),
  extra: Partial<Record<TermKind, string[]>> = {},
): AutoQuestion[] {
  const fullText = pages.map((p) => p.text).join(' ').toLowerCase();
  const all: { page: number; sentence: string; c: Candidate; score: number }[] = [];
  const pool = new Map<TermKind, Set<string>>();

  for (const p of pages) {
    for (const s of splitSentences(p.text)) {
      if (!usable(s)) continue;
      const cues = (s.match(CUES) ?? []).length;
      for (const c of candidates(s)) {
        (pool.get(c.kind) ?? pool.set(c.kind, new Set()).get(c.kind)!).add(c.answer);
        if (skipQuotes.has(s)) continue;
        const freq = fullText.split(c.answer.toLowerCase()).length - 1;
        const score = c.weight + cues * 0.6 + Math.min(freq - 1, 3) * 0.4 - (s.length > 220 ? 0.5 : 0);
        all.push({ page: p.page, sentence: s, c, score });
      }
    }
  }
  all.sort((a, b) => b.score - a.score);

  const usedAnswers = new Set<string>();
  const usedSentences = new Set<string>();
  const out: AutoQuestion[] = [];
  for (const x of all) {
    if (out.length >= count) break;
    const key = norm(x.c.answer);
    if (usedAnswers.has(key) || usedSentences.has(x.sentence)) continue;
    const blanked = blank(x.sentence, x.c.answer);
    if (!blanked) continue;
    // too little left to make sense of?
    if (blanked.replace(/_____/g, '').trim().length < 30) continue;

    let options: string[] | undefined;
    let correctIndex: number | undefined;
    // gene-like answers draw wrong options from other genes/proteins
    const kind: TermKind = x.c.kind === 'cause' && GENE_RE.test(x.c.answer) ? 'gene' : x.c.kind;
    const candidatesPool = [...(pool.get(kind) ?? []), ...(kind === 'gene' ? [...(pool.get('cause') ?? [])].filter((o) => GENE_RE.test(o)) : []), ...(extra[kind] ?? [])];
    const others =
      kind === 'number'
        ? numberDistractors(x.c.answer)
        : [...new Set(candidatesPool)].filter((o) => {
            const a = norm(o);
            return a && a !== key && !a.includes(key) && !key.includes(a) && !x.sentence.toLowerCase().includes(o.toLowerCase());
          });
    if (others.length >= 3) {
      const picked = shuffleSeeded(others, x.sentence.length).slice(0, Math.min(4, others.length));
      options = shuffleSeeded([x.c.answer, ...picked], x.sentence.length + 7);
      correctIndex = options.indexOf(x.c.answer);
    }
    usedAnswers.add(key);
    usedSentences.add(x.sentence);
    out.push({
      page: x.page,
      sentence: x.sentence,
      answer: x.c.answer,
      kind: x.c.kind,
      stem: `Complete the statement: “${blanked}”`,
      options,
      correctIndex,
      score: x.score,
    });
  }
  return out;
}

function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
