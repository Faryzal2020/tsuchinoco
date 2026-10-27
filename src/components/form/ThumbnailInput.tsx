'use client';
/* eslint-disable @next/next/no-img-element -- images are inline data URLs, next/image cannot optimise them */

// Pick an image, resize it in the browser, store it as a media document, return its id.
import React, { useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { mediaRepo } from '@/lib/repo';
import { IMAGE_MAX, THUMB_MAX, formatBytes, forgetMedia, uploadMediaFile, useMedia } from '@/lib/media';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export default function ThumbnailInput({ value, onChange, kind = 'thumbnail', size = 'md', className, title }: {
  value?: string;
  onChange: (id: string | undefined) => void;
  kind?: 'thumbnail' | 'image';
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
}) {
  const { me } = useAuth();
  const { run } = useToast();
  const media = useMedia(value);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    await run(async () => {
      const uploaded = await uploadMediaFile(file, kind, me);
      if (value) { mediaRepo.remove(value, media?.storagePath).catch(() => undefined); forgetMedia(value); }
      onChange(uploaded.id);
    });
    setBusy(false);
    if (input.current) input.current.value = '';
  };

  const remove = async () => {
    if (!value) return;
    setBusy(true);
    await run(async () => { await mediaRepo.remove(value, media?.storagePath); forgetMedia(value); onChange(undefined); });
    setBusy(false);
  };

  const imgSrc = media?.url || media?.dataUrl;
  const box = size === 'sm' ? 'h-9 w-9' : 'h-24 w-24';
  return (
    <div className={cn('flex items-center gap-2', className)} title={title}>
      <button type="button" className={cn('thumb-box', box, busy && 'opacity-60')} onClick={() => input.current?.click()} disabled={busy} aria-label={value ? 'Replace image' : 'Add image'}>
        {imgSrc
          ? <img src={imgSrc} alt="" />
          : <span className={size === 'sm' ? 'text-[10px]' : 'text-xs'}>{busy || (value && media === undefined) ? '…' : size === 'sm' ? '+' : 'Add image'}</span>}
      </button>
      {size === 'md' && (
        <div className="grid gap-1 text-xs">
          <div className="flex gap-1">
            <Button size="sm" onClick={() => input.current?.click()} busy={busy}>{value ? 'Replace' : 'Upload'}</Button>
            {value && <Button size="sm" variant="quiet" onClick={remove} disabled={busy}>Remove</Button>}
          </div>
          <span className="hint">{media ? `${media.width}×${media.height}, ${formatBytes(media.bytes)}` : kind === 'thumbnail' ? `Resized to ${THUMB_MAX} px. Shown on the preorder form.` : `Resized to ${IMAGE_MAX} px wide.`}</span>
        </div>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
