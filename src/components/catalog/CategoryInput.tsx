'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/Field';
import { CategoryPill, getCategoryColor } from '@/components/ui/Bits';
import { cn } from '@/lib/utils';

interface CategoryInputProps {
  value: string;
  onChange: (val: string) => void;
  existingCategories: string[];
  placeholder?: string;
  className?: string;
}

export default function CategoryInput({
  value,
  onChange,
  existingCategories,
  placeholder = 'e.g. Hololive, Umamusume, Original',
  className,
}: CategoryInputProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const trimmed = value.trim();
  const q = trimmed.toLowerCase();

  const matches = useMemo(() => {
    if (!q) return existingCategories.slice(0, 8);
    return existingCategories
      .filter((cat) => cat.toLowerCase().includes(q))
      .slice(0, 8);
  }, [existingCategories, q]);

  const isExactMatch = useMemo(() => {
    return existingCategories.some((cat) => cat.toLowerCase() === q);
  }, [existingCategories, q]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative flex items-center">
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={trimmed ? 'pr-20' : ''}
        />
        {trimmed && (
          <div className="absolute right-2 pointer-events-none">
            <CategoryPill category={trimmed} className="text-[11px] py-0 px-2" />
          </div>
        )}
      </div>

      {open && (matches.length > 0 || (trimmed && !isExactMatch)) && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 p-2.5 rounded-lg border border-line bg-white shadow-lg text-sm max-h-56 overflow-y-auto">
          {trimmed && !isExactMatch && (
            <div
              className="mb-2 p-1.5 rounded-md bg-yellow-soft/70 border border-yellow-2/40 flex items-center justify-between cursor-pointer hover:bg-yellow-soft transition-colors"
              onClick={() => {
                onChange(trimmed);
                setOpen(false);
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-yellow-ink">+ Create new:</span>
                <span className="font-bold text-ink">{trimmed}</span>
              </div>
              <span className="text-[11px] text-muted">Click to use</span>
            </div>
          )}

          {matches.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">
                {q ? 'Matching Categories' : 'Existing Categories'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {matches.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      onChange(cat);
                      setOpen(false);
                    }}
                    className={cn(
                      'pill border text-xs cursor-pointer transition-transform hover:scale-105 active:scale-95',
                      getCategoryColor(cat),
                      cat.toLowerCase() === q && 'ring-2 ring-blue-500 font-bold'
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
