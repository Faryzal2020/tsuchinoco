'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '@/lib/data';
import { hasRealVariants, variantsOf } from '@/lib/keys';
import { titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Item, OfferingEntry, Variant } from '@/types';
import { Input } from '@/components/ui/Field';
import Button from '@/components/ui/Button';

const entryKey = (e: OfferingEntry) => (e.variantId ? `${e.itemId}:${e.variantId}` : e.itemId);

/** One item as shown under the current filter: the variants listed are the ones the row acts on. */
type Row = { item: Item; variants: Variant[]; entries: OfferingEntry[]; allEntries: OfferingEntry[] };
type Group = { type: string; rows: Row[]; total: number };

const entriesOf = (item: Item, variants: Variant[]): OfferingEntry[] =>
  item.kind === 'bundle' ? [{ itemId: item.id }] : variants.map((v) => ({ itemId: item.id, variantId: v.id }));

/** Checkbox that can show a mixed state (some, not all, of what it covers is selected). */
function TriCheckbox({ checked, mixed, disabled, onToggle, label, className, children }: {
  checked: boolean; mixed: boolean; disabled?: boolean; onToggle: (on: boolean, shift: boolean) => void;
  label: React.ReactNode; className?: string; children?: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return (
    <label className={cn('inline-flex min-w-0 items-center gap-2 text-sm cursor-pointer select-none', className)}>
      <input ref={ref} type="checkbox" className="checkbox shrink-0" disabled={disabled} checked={checked}
        aria-checked={mixed ? 'mixed' : checked}
        // A mixed box selects everything on click, the usual convention.
        onChange={(e) => onToggle(mixed ? true : e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)} />
      <span className="min-w-0">{label}</span>
      {children}
    </label>
  );
}

export default function OfferingPicker({ value, onChange, disabled }: { value: OfferingEntry[]; onChange: (v: OfferingEntry[]) => void; disabled?: boolean }) {
  const { items, settings } = useData();
  const selected = useMemo(() => new Set(value.map(entryKey)), [value]);
  const [query, setQuery] = useState('');
  // Last item row clicked, so shift-click can fill the range in between.
  const anchor = useRef<{ type: string; index: number } | null>(null);

  const q = query.trim().toLowerCase();
  const groups = useMemo<Group[]>(() => {
    // Settings order first, then any type an item uses that Settings doesn't list, so no item goes missing.
    const norm = (t: string) => t.trim().toLowerCase();
    const types = [...new Set([
      ...settings.itemTypes.map(norm),
      ...items.filter((i) => i.active && i.kind === 'product').map((i) => norm(i.type)),
    ])].filter((t) => t && t !== 'bundle');
    types.push('bundle');
    return types.map((t) => {
      const inGroup = items.filter((i) => i.active && (t === 'bundle' ? i.kind === 'bundle' : i.kind === 'product' && norm(i.type) === t));
      const typeHit = !q || t.toLowerCase().includes(q);
      const rows: Row[] = [];
      for (const item of inGroup) {
        const active = variantsOf(item).filter((v) => v.active);
        const allEntries = entriesOf(item, active);
        let shown = active;
        if (!typeHit && !item.name.toLowerCase().includes(q)) {
          // Only a variant name matched: show and act on just those variants.
          shown = hasRealVariants(item) ? active.filter((v) => v.name.toLowerCase().includes(q)) : [];
          if (shown.length === 0) continue;
        }
        rows.push({ item, variants: shown, entries: entriesOf(item, shown), allEntries });
      }
      return { type: t, rows, total: inGroup.reduce((n, i) => n + entriesOf(i, variantsOf(i).filter((v) => v.active)).length, 0) };
    }).filter((g) => g.rows.length > 0);
  }, [items, settings.itemTypes, q]);

  const allCount = useMemo(() => items.filter((i) => i.active).reduce((n, i) => n + entriesOf(i, variantsOf(i).filter((v) => v.active)).length, 0), [items]);
  const shownEntries = groups.flatMap((g) => g.rows.flatMap((r) => r.entries));

  const set = (entries: OfferingEntry[], on: boolean) => {
    const next = new Map(value.map((e) => [entryKey(e), e]));
    for (const e of entries) { if (on) next.set(entryKey(e), e); else next.delete(entryKey(e)); }
    onChange([...next.values()]);
  };
  const countOn = (entries: OfferingEntry[]) => entries.reduce((n, e) => n + (selected.has(entryKey(e)) ? 1 : 0), 0);

  const toggleRow = (g: Group, index: number, on: boolean, shift: boolean) => {
    const a = anchor.current;
    if (shift && a && a.type === g.type && a.index !== index) {
      const [from, to] = a.index < index ? [a.index, index] : [index, a.index];
      set(g.rows.slice(from, to + 1).flatMap((r) => r.entries), on);
    } else {
      set(g.rows[index].entries, on);
    }
    anchor.current = { type: g.type, index };
  };

  const filtered = q !== '';
  const shownOn = countOn(shownEntries);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input small type="search" placeholder="Filter by type, item or variant" value={query}
          onChange={(e) => { setQuery(e.target.value); anchor.current = null; }} className="!w-64 max-w-full" aria-label="Filter the offering" />
        <Button size="sm" disabled={disabled || shownOn === shownEntries.length} onClick={() => set(shownEntries, true)}>{filtered ? 'Select shown' : 'Select all'}</Button>
        <Button size="sm" disabled={disabled || shownOn === 0} onClick={() => (filtered ? set(shownEntries, false) : onChange([]))}>{filtered ? 'Clear shown' : 'Clear all'}</Button>
        <span className="ml-auto text-sm text-ink-2"><b className="text-ink">{value.length}</b> of {allCount} selected</span>
      </div>
      <p className="hint mb-3">Tick a type&apos;s header to take the whole group. Shift-click a second item to select or clear every item between the two.{filtered && ' While filtering, every action covers only the rows shown.'}</p>

      {groups.length === 0 && <p className="hint py-6 text-center">Nothing matches &ldquo;{query}&rdquo;.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => {
          const groupEntries = g.rows.flatMap((r) => r.entries);
          const on = countOn(groupEntries);
          const allGroupOn = countOn(g.rows.flatMap((r) => r.allEntries));
          return (
            <section key={g.type} className={cn('rounded-lg border p-3 transition-colors', allGroupOn > 0 ? 'border-blue/40 bg-white' : 'border-line')}>
              <div className="-mx-3 -mt-3 mb-2 flex items-center gap-2 rounded-t-lg border-b border-line bg-cream-2/60 px-3 py-2">
                <TriCheckbox disabled={disabled} checked={on === groupEntries.length} mixed={on > 0 && on < groupEntries.length}
                  onToggle={(v) => set(groupEntries, v)} label={<span className="font-bold">{titleCase(g.type)}</span>} />
                <span className={cn('ml-auto text-xs tabular-nums', allGroupOn > 0 ? 'text-blue-ink' : 'text-muted')}>{allGroupOn}/{g.total}</span>
              </div>
              <div className="grid gap-1">
                {g.rows.map((row, index) => {
                  const rowOn = countOn(row.entries);
                  const variants = hasRealVariants(row.item);
                  return (
                    <div key={row.item.id} className="rounded-md px-1 py-0.5 hover:bg-cream">
                      <div className="flex items-center gap-2">
                        <TriCheckbox disabled={disabled} checked={rowOn === row.entries.length} mixed={rowOn > 0 && rowOn < row.entries.length}
                          onToggle={(v, shift) => toggleRow(g, index, v, shift)} label={row.item.name} />
                        {variants && <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">{countOn(row.allEntries)}/{row.allEntries.length}</span>}
                      </div>
                      {variants && (
                        <div className="ml-6 mt-1 mb-1 flex flex-wrap gap-1.5">
                          {row.variants.map((v) => {
                            const e = { itemId: row.item.id, variantId: v.id };
                            const isOn = selected.has(entryKey(e));
                            return (
                              <button key={v.id} type="button" className="chip-toggle" aria-pressed={isOn} disabled={disabled}
                                onClick={() => set([e], !isOn)}>{v.name}</button>
                            );
                          })}
                          {row.variants.length > 1 && (
                            <button type="button" className="text-xs text-blue-ink underline-offset-2 hover:underline disabled:opacity-50" disabled={disabled}
                              onClick={() => set(row.entries, rowOn < row.entries.length)}>{rowOn < row.entries.length ? 'all' : 'none'}</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
