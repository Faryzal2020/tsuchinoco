'use client';

import React, { useMemo } from 'react';
import { useData } from '@/lib/data';
import { hasRealVariants, variantsOf } from '@/lib/keys';
import { titleCase } from '@/lib/format';
import type { OfferingEntry } from '@/types';
import { Checkbox } from '@/components/ui/Field';
import Button from '@/components/ui/Button';

const entryKey = (e: OfferingEntry) => (e.variantId ? `${e.itemId}:${e.variantId}` : e.itemId);

export default function OfferingPicker({ value, onChange, disabled }: { value: OfferingEntry[]; onChange: (v: OfferingEntry[]) => void; disabled?: boolean }) {
  const { items, settings } = useData();
  const selected = useMemo(() => new Set(value.map(entryKey)), [value]);

  const groups = useMemo(() => {
    const types = [...settings.itemTypes, 'bundle'];
    return types.map((t) => ({ type: t, items: items.filter((i) => i.active && (t === 'bundle' ? i.kind === 'bundle' : i.kind === 'product' && i.type === t)) })).filter((g) => g.items.length > 0);
  }, [items, settings.itemTypes]);

  const toggle = (entries: OfferingEntry[], on: boolean) => {
    const next = new Map(value.map((e) => [entryKey(e), e]));
    for (const e of entries) { if (on) next.set(entryKey(e), e); else next.delete(entryKey(e)); }
    onChange([...next.values()]);
  };

  const entriesFor = (itemId: string): OfferingEntry[] => {
    const item = items.find((i) => i.id === itemId)!;
    if (item.kind === 'bundle') return [{ itemId }];
    return variantsOf(item).filter((v) => v.active).map((v) => ({ itemId, variantId: v.id }));
  };

  const all = groups.flatMap((g) => g.items.flatMap((i) => entriesFor(i.id)));

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-ink-2">{value.length} of {all.length} selected</span>
        <Button size="sm" disabled={disabled} onClick={() => toggle(all, true)}>Select all</Button>
        <Button size="sm" disabled={disabled} onClick={() => onChange([])}>Clear</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.type} className="rounded-lg border border-line p-3">
            <div className="eyebrow mb-2">{titleCase(g.type)}</div>
            <div className="grid gap-1.5">
              {g.items.map((item) => {
                const entries = entriesFor(item.id);
                const allOn = entries.every((e) => selected.has(entryKey(e)));
                const someOn = entries.some((e) => selected.has(entryKey(e)));
                return (
                  <div key={item.id}>
                    <Checkbox label={item.name} disabled={disabled} checked={allOn}
                      onChange={(e) => toggle(entries, e.target.checked)}
                      className={someOn && !allOn ? 'opacity-80' : ''} />
                    {hasRealVariants(item) && (
                      <div className="ml-6 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        {variantsOf(item).filter((v) => v.active).map((v) => {
                          const e = { itemId: item.id, variantId: v.id };
                          return <Checkbox key={v.id} label={v.name} disabled={disabled} checked={selected.has(entryKey(e))} onChange={(ev) => toggle([e], ev.target.checked)} className="text-[13px] text-ink-2" />;
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
