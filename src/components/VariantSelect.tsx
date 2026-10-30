'use client';

import React from 'react';
import { useData } from '@/lib/data';
import { variantKey, variantsOf, hasRealVariants, splitKey } from '@/lib/keys';
import { Select } from '@/components/ui/Field';

/** Select one product variant. Value is a variantKey. */
export function VariantSelect({ value, onChange, small, excludeItemId, placeholder = 'Choose a variant…', className }: {
  value: string;
  onChange: (key: string) => void;
  small?: boolean;
  excludeItemId?: string;
  placeholder?: string;
  className?: string;
}) {
  const { items } = useData();
  // The currently selected key stays listed even when its item or variant is inactive,
  // so an edit opened from an inactive row shows the right selection.
  const sel = value ? splitKey(value) : null;
  const products = items.filter((i) => i.kind === 'product' && (i.active || i.id === sel?.itemId) && i.id !== excludeItemId);
  const keep = (itemId: string, variantId: string) => sel?.itemId === itemId && sel?.variantId === variantId;
  return (
    <Select small={small} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{placeholder}</option>
      {products.map((item) => {
        const inactiveItem = !item.active ? ' (inactive)' : '';
        return hasRealVariants(item) ? (
          <optgroup key={item.id} label={item.name + inactiveItem}>
            {variantsOf(item).filter((v) => v.active || keep(item.id, v.id)).map((v) => (
              <option key={v.id} value={variantKey(item.id, v.id)}>{item.name} · {v.name}{!v.active ? ' (inactive)' : inactiveItem}</option>
            ))}
          </optgroup>
        ) : (
          <option key={item.id} value={variantKey(item.id, variantsOf(item)[0].id)}>{item.name}{inactiveItem}</option>
        );
      })}
    </Select>
  );
}

/** Resolve a variantKey to display text, tolerating deleted items. */
export function useVariantLabel() {
  const { itemsById } = useData();
  return (itemId: string, variantId: string): { item: string; variant: string } => {
    const item = itemsById.get(itemId);
    if (!item) return { item: `(deleted ${itemId})`, variant: variantId === 'default' ? '' : variantId };
    const v = item.variants.find((x) => x.id === variantId);
    return { item: item.name, variant: v ? v.name : variantId === 'default' ? '' : `(${variantId})` };
  };
}
