import type { Item, Variant } from '@/types';

export const DEFAULT_VARIANT_ID = 'default';

export const variantKey = (itemId: string, variantId: string) => `${itemId}:${variantId}`;

export const splitKey = (key: string): { itemId: string; variantId: string } => {
  const i = key.indexOf(':');
  return { itemId: key.slice(0, i), variantId: key.slice(i + 1) };
};

/** Every item has at least one variant. Items without real variants get the hidden default. */
export const variantsOf = (item: Item): Variant[] =>
  item.kind === 'product' && item.variants.length > 0
    ? item.variants
    : [{ id: DEFAULT_VARIANT_ID, name: '', active: true }];

export const hasRealVariants = (item: Item) => item.kind === 'product' && item.variants.length > 0;

export const variantName = (item: Item | undefined, variantId: string): string => {
  if (!item) return variantId;
  const v = item.variants.find((x) => x.id === variantId);
  return v ? v.name : '';
};

/** "Item name" or "Item name · Variant" */
export const variantLabel = (item: Item | undefined, variantId: string): string => {
  if (!item) return `${variantId}`;
  const vn = variantName(item, variantId);
  return vn ? `${item.name} · ${vn}` : item.name;
};

export const newId = (len = 10): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
};

export const variantOf = (item: Item | undefined, variantId?: string): Variant | undefined => {
  if (!item || !variantId || variantId === DEFAULT_VARIANT_ID) return undefined;
  return item.variants?.find((v) => v.id === variantId);
};

export const variantPrice = (item: Item | undefined, variantId?: string): number => {
  if (!item) return 0;
  const v = variantOf(item, variantId);
  return typeof v?.price === 'number' ? v.price : item.price;
};

export const variantOtsPrice = (item: Item | undefined, variantId?: string): number => {
  if (!item) return 0;
  const v = variantOf(item, variantId);
  if (typeof v?.otsPrice === 'number') return v.otsPrice;
  if (typeof item.otsPrice === 'number') return item.otsPrice;
  return variantPrice(item, variantId);
};

export const variantPriceJpy = (item: Item | undefined, variantId?: string): number | undefined => {
  if (!item) return undefined;
  const v = variantOf(item, variantId);
  if (typeof v?.priceJpy === 'number') return v.priceJpy;
  return item.priceJpy;
};

export const variantSku = (item: Item | undefined, variantId?: string): string => {
  if (!item) return '';
  const v = variantOf(item, variantId);
  if (v?.sku) return v.sku;
  return item.sku ?? '';
};

