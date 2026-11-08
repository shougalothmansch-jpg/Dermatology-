import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useTheme } from '../lib/settings';

const BASE_CSS = `
:host { display: block; }
.card { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 18px; line-height: 1.5; text-align: center;
  background: transparent !important; color: inherit; padding: 0 !important; margin: 0 !important; overflow-wrap: anywhere; }
img { max-width: 100% !important; height: auto !important; cursor: zoom-in; border-radius: 6px; }
.cloze { font-weight: 700; color: #1d4ed8; }
.nightMode .cloze, .night_mode .cloze { color: #93c5fd; }
details.hint summary { cursor: pointer; color: #277a75; }
table { margin: 0 auto; border-collapse: collapse; max-width: 100%; }
td, th { border: 1px solid rgba(127,127,127,.35); padding: 4px 6px; }
.missing-media { display: inline-block; padding: 6px 10px; border: 1px dashed rgba(127,127,127,.6); border-radius: 6px; font-size: 13px; opacity: .8; }
`;

// applied after the deck's CSS so cards blend into the app and images fit the phone
const POST_CSS = `.card { background: transparent !important; padding: 0 !important; margin: 0 !important; }
img { max-width: 100% !important; height: auto !important; }`;
const DARK_OVERRIDES = `.card { color: #e2e8f0 !important; }`;

/** Removes scripts and event handlers from deck HTML; returns the safe HTML and the media it references. */
function sanitize(html: string): { html: string; media: string[] } {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root')!;
  root.querySelectorAll('script, iframe, object, embed, link, meta, base, form, audio, video').forEach((el) => el.remove());
  const media = new Set<string>();
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on') || ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      if (src && !/^(https?:|data:|blob:)/i.test(src)) {
        let name = src;
        try {
          name = decodeURIComponent(src);
        } catch {
          /* keep raw */
        }
        el.setAttribute('data-media', name);
        el.removeAttribute('src');
        media.add(name);
      }
    }
  });
  return { html: root.innerHTML, media: [...media] };
}

/**
 * Renders an Anki card side inside a shadow root so the deck's own CSS
 * can't leak into the app. Tapping an image opens it full-screen.
 */
export default function AnkiCardView({ html, notetypeId }: { html: string; notetypeId?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [theme] = useTheme();
  const notetype = useLiveQuery(async () => (notetypeId ? await db.ankiNotetypes.get(notetypeId) : undefined), [notetypeId]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    const { html: safe, media } = sanitize(html);
    const dark = theme === 'dark';
    shadow.innerHTML = `<style>${BASE_CSS}\n${notetype?.css ?? ''}\n${POST_CSS}\n${dark ? DARK_OVERRIDES : ''}</style><div class="card${dark ? ' nightMode night_mode' : ''}">${safe}</div>`;

    const urls: string[] = [];
    let cancelled = false;
    if (media.length) {
      db.media.bulkGet(media).then((files) => {
        if (cancelled) return;
        const byName = new Map(media.map((m, i) => [m, files[i]]));
        shadow.querySelectorAll<HTMLImageElement>('img[data-media]').forEach((img) => {
          const f = byName.get(img.dataset.media!);
          if (f) {
            const u = URL.createObjectURL(f.blob);
            urls.push(u);
            img.src = u;
          } else {
            const span = document.createElement('span');
            span.className = 'missing-media';
            span.textContent = `🖼 ${img.dataset.media} (re-import the deck to restore images)`;
            img.replaceWith(span);
          }
        });
      });
    }
    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'IMG' && (t as HTMLImageElement).src) setZoom((t as HTMLImageElement).src);
    };
    shadow.addEventListener('click', onClick);
    return () => {
      cancelled = true;
      shadow.removeEventListener('click', onClick);
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [html, notetype?.css, theme]);

  return (
    <>
      <div ref={host} />
      {zoom && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-2" onClick={() => setZoom(null)} role="dialog" aria-label="Image">
          <img src={zoom} alt="" className="max-h-full max-w-full object-contain" />
          <button className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] rounded-full bg-white/15 px-3 py-1.5 text-white" aria-label="Close">✕</button>
        </div>
      )}
    </>
  );
}
