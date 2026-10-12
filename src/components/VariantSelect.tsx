'use client';

import React from 'react';
import { useData } from '@/lib/data';
import { variantKey, variantsOf, hasRealVariants } from '@/lib/keys';
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
  const products = items.filter((i) => i.kind === 'product' && i.active && i.id !== excludeItemId);
  return (
    <Select small={small} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{placeholder}</option>
      {products.map((item) =>
        hasRealVariants(item) ? (
          <optgroup key={item.id} label={item.name}>
            {variantsOf(item).filter((v) => v.active).map((v) => (
              <option key={v.id} value={variantKey(item.id, v.id)}>{item.name} · {v.name}</option>
            ))}
          </optgroup>
        ) : (
          <option key={item.id} value={variantKey(item.id, variantsOf(item)[0].id)}>{item.name}</option>
        ),
      )}
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
