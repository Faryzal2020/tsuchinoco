// Per-page list filters remembered in the browser. Multi-value filters are pipe-separated in
// the URL (so links stay shareable; categories may contain commas) and mirrored into
// localStorage so they survive navigation.

const SEP = '|';
export const parseList = (s: string): string[] => s ? s.split(SEP).map((x) => x.trim()).filter(Boolean) : [];
export const joinList = (xs: string[]): string => xs.join(SEP);

export const readFilterPrefs = (key: string): Record<string, string> => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
};

export const writeFilterPrefs = (key: string, prefs: Record<string, string>) => {
  try {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(prefs)) if (v) clean[k] = v;
    if (Object.keys(clean).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(clean));
  } catch { /* ignore */ }
};

// ---- Hook: URL query params as the live state, localStorage as the memory. ----
import { useEffect, useRef } from 'react';
import { useQuery } from './useQuery';

/**
 * Filters live in the URL (shareable) and are remembered per page in localStorage. On first
 * render a URL without any of the keys is filled from storage; a URL that carries them wins
 * and is saved. Every change made through `setFilters` is written to both.
 */
export function usePersistedFilters(storageKey: string, keys: readonly string[]) {
  const { get, set, sp } = useQuery();
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const fromUrl: Record<string, string> = {};
    let anyInUrl = false;
    for (const k of keys) { const v = sp.get(k) ?? ''; fromUrl[k] = v; if (v) anyInUrl = true; }
    if (anyInUrl) { writeFilterPrefs(storageKey, fromUrl); return; }
    const saved = readFilterPrefs(storageKey);
    const patch: Record<string, string> = {};
    for (const k of keys) if (saved[k]) patch[k] = saved[k];
    if (Object.keys(patch).length > 0) set(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time hydration
  }, []);

  const setFilters = (patch: Record<string, string | null>) => {
    set(patch);
    const next: Record<string, string> = {};
    for (const k of keys) next[k] = sp.get(k) ?? '';
    for (const [k, v] of Object.entries(patch)) next[k] = v ?? '';
    writeFilterPrefs(storageKey, next);
  };

  return { get, setFilters };
}
