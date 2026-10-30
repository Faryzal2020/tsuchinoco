'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface MultiSelectOption { value: string; label: string }

/**
 * Compact multi-select dropdown styled like the toolbar selects. Shows "All <noun>" when
 * nothing is chosen, the single label when one is chosen, and "N <noun>" for more.
 */
export function MultiSelect({ values, options, onChange, allLabel, noun, small = true, className }: {
  values: string[];
  options: MultiSelectOption[];
  onChange: (next: string[]) => void;
  /** Shown when nothing is selected, e.g. "All Types". */
  allLabel: string;
  /** Plural noun for the count summary, e.g. "types". */
  noun: string;
  small?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const chosen = options.filter((o) => values.includes(o.value));
  const summary = chosen.length === 0 ? allLabel : chosen.length === 1 ? chosen[0].label : `${chosen.length} ${noun}`;

  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn('select text-left w-full cursor-pointer', small && 'input-sm', chosen.length > 0 && 'font-semibold')}
      >
        <span className="block truncate">{summary}</span>
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute left-0 top-full z-30 mt-1 min-w-full w-max max-w-[280px] max-h-72 overflow-y-auto rounded-lg border border-line bg-white shadow-lg p-1">
          {options.length === 0 && <div className="px-2 py-1.5 text-xs text-muted">No options</div>}
          {options.map((o) => {
            const on = values.includes(o.value);
            return (
              <label key={o.value} role="option" aria-selected={on} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-cream">
                <input type="checkbox" className="checkbox" checked={on} onChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            );
          })}
          {chosen.length > 0 && (
            <button type="button" onClick={() => { onChange([]); }} className="w-full mt-1 px-2 py-1.5 text-xs font-semibold text-blue-ink hover:bg-blue-soft rounded-md text-left cursor-pointer border-t border-line">
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
