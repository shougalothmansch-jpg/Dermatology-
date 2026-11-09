import { useState } from 'react';

const KEY = 'dermpath.safariNoticeDismissed';

function inIosSafariTab(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !standalone;
}

/**
 * On iPhone, a Safari tab and the Home Screen app keep separate storage, so
 * PDFs and questions added in one don't appear in the other. Say so.
 */
export default function SafariNotice() {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  if (hidden || !inIosSafariTab()) return null;
  return (
    <div className="no-print mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <div className="font-semibold">You're using Derm Path in a Safari tab</div>
      <p className="mt-1">
        On iPhone, data here is <b>separate</b> from the Home Screen app — PDFs, cards and progress added in one won't appear in the other. Tap <b>Share → Add to Home Screen</b> and use only that icon.
      </p>
      <button
        className="mt-2 text-xs font-medium underline"
        onClick={() => {
          try {
            sessionStorage.setItem(KEY, '1');
          } catch {
            /* ignore */
          }
          setHidden(true);
        }}
      >
        Hide for now
      </button>
    </div>
  );
}
