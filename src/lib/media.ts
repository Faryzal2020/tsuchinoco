// Cloud Storage media: resized in browser and uploaded to Cloud Storage.
// Public form snapshots reference download URLs instead of large inline base64 strings.
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import { newId } from './keys';
import { mediaRepo } from './repo';
import type { Media } from '@/types';

export const THUMB_MAX = 480;
export const IMAGE_MAX = 1600;

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
export async function resizeImage(file: File, max: number, quality = 0.85): Promise<ResizedImage> {
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

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bin = atob(base64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

/** Resizes an image file and uploads it to Cloud Storage under media/{id}. */
export async function uploadMediaFile(file: File, kind: 'thumbnail' | 'image', by: string): Promise<Media> {
  const r = await resizeImage(file, kind === 'thumbnail' ? THUMB_MAX : IMAGE_MAX);
  const id = newId();
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `media/${id}_${safeName}`;

  let url: string | undefined;
  try {
    const blob = dataUrlToBlob(r.dataUrl);
    const storageRef = ref(storage, storagePath);
    const snap = await uploadBytes(storageRef, blob, { contentType: r.mime });
    url = await getDownloadURL(snap.ref);
  } catch (err) {
    console.warn('[media] Could not upload to Cloud Storage, falling back to dataUrl:', err);
  }

  const media: Media = {
    id,
    kind,
    mime: r.mime,
    url,
    storagePath: url ? storagePath : undefined,
    dataUrl: url ? undefined : r.dataUrl, // only fallback if storage upload failed
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    name: file.name,
    createdAt: Date.now(),
    createdBy: by,
  };

  await mediaRepo.createWithId(media);
  primeMedia(media);
  return media;
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
