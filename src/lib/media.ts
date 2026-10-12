'use client';

// Images without Cloud Storage: resized in the browser and stored as data URLs in the
// `media` collection. Thumbnails are small (240 px) so a whole form fits in one Firestore
// document when published. Swap the storage side for Cloud Storage later (roadmap phase 4).
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Media } from '@/types';

export const THUMB_MAX = 240;
export const IMAGE_MAX = 1200;

export interface ResizedImage { dataUrl: string; width: number; height: number; bytes: number; mime: string }

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read.')); };
    img.src = url;
  });
}

/** Scale the longest side down to `max` pixels and encode as JPEG on a white background. */
export async function resizeImage(file: File, max: number, quality = 0.82): Promise<ResizedImage> {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the image.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, width, height, bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75), mime: 'image/jpeg' };
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

// ---- Read-through cache. Media documents never change, only get replaced, so caching by id is safe. ----

const cache = new Map<string, Media | null>();
const pending = new Map<string, Promise<Media | null>>();

export function fetchMedia(id: string): Promise<Media | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id)!);
  const p = pending.get(id);
  if (p) return p;
  const task = getDoc(doc(db, 'media', id))
    .then((s) => (s.exists() ? ({ id: s.id, ...(s.data() as Omit<Media, 'id'>) }) : null))
    .catch(() => null)
    .then((m) => { cache.set(id, m); pending.delete(id); return m; });
  pending.set(id, task);
  return task;
}

export function fetchManyMedia(ids: string[]): Promise<Map<string, Media>> {
  const unique = [...new Set(ids.filter(Boolean))];
  return Promise.all(unique.map((id) => fetchMedia(id).then((m) => [id, m] as const)))
    .then((pairs) => new Map(pairs.filter((p): p is readonly [string, Media] => !!p[1])));
}

export function primeMedia(m: Media) { cache.set(m.id, m); }
export function forgetMedia(id: string) { cache.delete(id); }

/** Resolve one media id to its document. undefined while loading, null when missing. */
export function useMedia(id: string | undefined): Media | null | undefined {
  const [m, setM] = useState<Media | null | undefined>(id ? cache.get(id) : null);
  useEffect(() => {
    if (!id) { setM(null); return; }
    if (cache.has(id)) { setM(cache.get(id)!); return; }
    let alive = true;
    setM(undefined);
    fetchMedia(id).then((x) => { if (alive) setM(x); });
    return () => { alive = false; };
  }, [id]);
  return m;
}
