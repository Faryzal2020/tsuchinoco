// Every price a customer is charged is worked out here: the staff app, the customer form and the
// importer all call quote(). Pure functions only; Firestore writes for the price list are in prices.ts.
import type { Batch, Item, OrderType, PriceBasis, Settings, StorefrontSettings } from '@/types';
import { DEFAULT_STOREFRONT } from '../types';
import { splitKey, variantKey, variantOf, variantOtsPrice, variantPrice, variantsOf } from './keys';

export const storefrontOf = (s: Pick<Settings, 'storefront'>): StorefrontSettings => ({
  ...DEFAULT_STOREFRONT,
  ...(s.storefront ?? {}),
  priceBasis: { ...DEFAULT_STOREFRONT.priceBasis, ...(s.storefront?.priceBasis ?? {}) },
  couriers: s.storefront?.couriers ?? DEFAULT_STOREFRONT.couriers,
});

/** A preorder batch takes preorders; a post-event batch and the store channel take mail orders. */
export const orderTypeForBatch = (batch: Pick<Batch, 'mode'>): OrderType => (batch.mode === 'post' ? 'mail_order' : 'preorder');

/** A usable discount is a whole or fractional percent strictly between 0 and 100. */
export const validDiscount = (pct: number | undefined): number | undefined =>
  typeof pct === 'number' && Number.isFinite(pct) && pct > 0 && pct < 100 ? pct : undefined;

/** Discounted prices round up to the next Rp1.000. Prices without a discount are not rounded. */
export const applyDiscount = (price: number, pct: number | undefined): number => {
  const d = validDiscount(pct);
  if (!d) return price;
  return Math.ceil((price * (100 - d)) / 100 / 1000) * 1000;
};

export interface CatalogPrice {
  po: number;
  ots: number;
  discountPercent?: number;
}

/** Orderable keys of an item: variant keys for products, the item id for bundles. */
export const keysOf = (item: Item): string[] =>
  item.kind === 'bundle' ? [item.id] : variantsOf(item).map((v) => variantKey(item.id, v.id));

/** The current catalogue price of one key, read from the item. A variant's discount overrides the item's, 0 included. */
export function catalogPrice(item: Item, key: string): CatalogPrice {
  if (item.kind === 'bundle') {
    return { po: item.price, ots: item.otsPrice ?? item.price, discountPercent: validDiscount(item.discountPercent) };
  }
  const { variantId } = splitKey(key);
  const v = variantOf(item, variantId);
  const pct = typeof v?.discountPercent === 'number' ? v.discountPercent : item.discountPercent;
  return { po: variantPrice(item, variantId), ots: variantOtsPrice(item, variantId), discountPercent: validDiscount(pct) };
}

export interface Quote {
  unitPrice: number;
  basis: PriceBasis;
  discountPercent?: number;
  /** Struck-through price shown beside unitPrice. */
  refPrice?: number;
  refLabel?: 'OTS' | 'Normal';
}

/**
 * Price for one line.
 * Base: the event's offering override if set, else PO or OTS by the order type's basis.
 * Then the discount, rounded up to the next 1.000.
 * Reference: on a preorder the OTS price whenever it is higher; on a mail order the undiscounted base.
 */
export function quote(p: CatalogPrice, orderType: OrderType, basis: Record<OrderType, 'po' | 'ots'>, override?: number): Quote {
  const b = basis[orderType] ?? (orderType === 'preorder' ? 'po' : 'ots');
  const hasOverride = typeof override === 'number';
  const base = hasOverride ? override : b === 'ots' ? p.ots : p.po;
  const pct = validDiscount(p.discountPercent);
  const unitPrice = applyDiscount(base, pct);
  let refPrice: number | undefined;
  let refLabel: Quote['refLabel'];
  if (orderType === 'preorder' && p.ots > unitPrice) { refPrice = p.ots; refLabel = 'OTS'; }
  else if (pct && base > unitPrice) { refPrice = base; refLabel = 'Normal'; }
  return { unitPrice, basis: hasOverride ? 'override' : b, discountPercent: pct, refPrice, refLabel };
}

export const samePrice = (a: CatalogPrice | undefined, b: CatalogPrice | undefined): boolean =>
  !!a && !!b && a.po === b.po && a.ots === b.ots && (validDiscount(a.discountPercent) ?? 0) === (validDiscount(b.discountPercent) ?? 0);
