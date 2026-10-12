'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint mt-1 block">{hint}</span>}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { small?: boolean }>(
  function Input({ className, small, ...props }, ref) {
    return <input ref={ref} className={cn('input', small && 'input-sm', className)} {...props} />;
  },
);

export function Select({ className, small, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { small?: boolean }) {
  return (
    <select className={cn('select', small && 'input-sm', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('textarea', className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-sm cursor-pointer', className)}>
      <input type="checkbox" className="checkbox" {...props} />
      {label && <span>{label}</span>}
    </label>
  );
}

/** Numeric cell that saves on blur or Enter. Empty string = null when allowNull. */
export function NumberCell({
  value, onCommit, allowNull = false, min, className, disabled, title,
}: {
  value: number | null;
  onCommit: (v: number | null) => unknown;
  allowNull?: boolean;
  min?: number;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [text, setText] = React.useState(value === null ? '' : String(value));
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => { if (!dirty) setText(value === null ? '' : String(value)); }, [value, dirty]);

  const commit = async () => {
    if (!dirty) return;
    const trimmed = text.trim();
    if (trimmed === '') {
      if (allowNull) { await onCommit(null); setDirty(false); return; }
      setText(value === null ? '' : String(value)); setDirty(false); return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || (min !== undefined && n < min)) { setText(value === null ? '' : String(value)); setDirty(false); return; }
    await onCommit(Math.round(n));
    setDirty(false);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      className={cn('input input-sm num-cell', dirty && 'dirty', className)}
      value={text}
      disabled={disabled}
      title={title}
      onChange={(e) => { setText(e.target.value); setDirty(true); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(value === null ? '' : String(value)); setDirty(false); } }}
    />
  );
}
