import { useEffect, useState } from 'react';

const KEYS = {
  theme: 'dermpath.theme',
  apiKey: 'dermpath.anthropicKey',
  aiEnabled: 'dermpath.aiEnabled',
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent('dermpath-settings'));
}

function useSetting(key: string): [string | null, (v: string | null) => void] {
  const [val, setVal] = useState<string | null>(() => read(key));
  useEffect(() => {
    const h = () => setVal(read(key));
    window.addEventListener('dermpath-settings', h);
    window.addEventListener('storage', h);
    return () => {
      window.removeEventListener('dermpath-settings', h);
      window.removeEventListener('storage', h);
    };
  }, [key]);
  return [val, (v) => write(key, v)];
}

export type Theme = 'light' | 'dark';

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function setTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  write(KEYS.theme, t);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force((x) => x + 1);
    window.addEventListener('dermpath-settings', h);
    return () => window.removeEventListener('dermpath-settings', h);
  }, []);
  return [currentTheme(), setTheme];
}

export function useApiKey() {
  return useSetting(KEYS.apiKey);
}

export function useAiEnabled(): [boolean, (v: boolean) => void] {
  const [v, set] = useSetting(KEYS.aiEnabled);
  return [v === 'true', (b) => set(b ? 'true' : null)];
}

export function getApiKey(): string | null {
  return read(KEYS.apiKey);
}
