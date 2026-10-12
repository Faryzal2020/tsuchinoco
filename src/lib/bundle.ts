import type { BundleComponent, Item, OrderLine, RawLine } from '@/types';
import { DEFAULT_VARIANT_ID } from './keys';

/**
 * Split a bundle's price across its components (spec 4.4).
 * Explicit allocatedPrice wins; otherwise proportional to list price; the
 * rounding remainder lands on the last component so the sum is exact.
 */
export function allocateBundlePrice(
  bundle: Pick<Item, 'price' | 'components'>,
  itemsById: Map<string, Item>,
): Map<string, number> {
  const out = new Map<string, number>();
  const comps = bundle.components;
  if (comps.length === 0) return out;

  const listPrice = (c: BundleComponent) => itemsById.get(c.itemId)?.price ?? 0;
  const listTotal = comps.reduce((s, c) => s + c.qty * listPrice(c), 0);

  let remaining = bundle.price;
  comps.forEach((c, idx) => {
    const key = `${c.itemId}:${c.variantId}`;
    let unit: number;
    if (typeof c.allocatedPrice === 'number') {
      unit = c.allocatedPrice;
    } else if (idx === comps.length - 1) {
      unit = c.qty > 0 ? Math.round(remaining / c.qty) : 0;
    } else if (listTotal > 0) {
      unit = Math.round((bundle.price * listPrice(c)) / listTotal);
    } else {
      unit = Math.round(bundle.price / comps.reduce((s, x) => s + x.qty, 0));
    }
    out.set(key, unit);
    remaining -= unit * c.qty;
  });
  return out;
}

/** Expand raw order lines into per-variant lines. Products pass through; bundles expand. */
export function expandLines(rawLines: RawLine[], itemsById: Map<string, Item>): OrderLine[] {
  const lines: OrderLine[] = [];
  for (const raw of rawLines) {
    const item = itemsById.get(raw.itemId);
    if (item && item.kind === 'bundle') {
      const alloc = allocateBundlePrice({ price: raw.unitPrice, components: item.components }, itemsById);
      for (const c of item.components) {
        lines.push({
          itemId: c.itemId,
          variantId: c.variantId,
          qty: c.qty * raw.qty,
          unitPrice: alloc.get(`${c.itemId}:${c.variantId}`) ?? 0,
          fromBundleItemId: item.id,
        });
      }
    } else {
      lines.push({
        itemId: raw.itemId,
        variantId: raw.variantId ?? DEFAULT_VARIANT_ID,
        qty: raw.qty,
        unitPrice: raw.unitPrice,
      });
    }
  }
  return lines;
}
