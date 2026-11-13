// Shipping weights and fees, shared by the staff app, the customer pages and (later) the Cloud
// Functions. Pure: no Firebase imports, and value imports are relative so plain Node can load it.
//
// Lion Parcel bills whole kilograms: a remainder above 0.3 kg rounds up, so 1,301 g is 1 kg and
// 1,310 g is 2 kg (checked against Biteship on 2026-11-11; its prices matched lionparcel.com).
import { DEFAULT_VARIANT_ID, splitKey } from './keys';
import { DEFAULT_SHIPPING, type FormSettings, type Item, type OrderShipping, type PublicForm, type Settings, type ShippingOption, type ShippingQuote, type ShippingSettings, type Submission } from '../types';

/** Added to every parcel for the mailer and padding. Fixed by decision, not a setting. */
export const PACKING_GRAMS = 100;
/** Part of a kilogram that is not charged yet. */
const TOLERANCE_GRAMS = 300;

export const shippingOf = (s: Pick<Settings, 'storefront'>): ShippingSettings => ({ ...DEFAULT_SHIPPING, ...(s.storefront?.shipping ?? {}) });

/** A usable weight is a positive whole number of grams. */
export const validWeight = (g: number | undefined): number | undefined =>
  typeof g === 'number' && Number.isFinite(g) && g > 0 ? Math.round(g) : undefined;

/** A usable fee is zero or more whole rupiah. */
export const validFee = (n: number | undefined): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;

/** The fees a shipped order pays: the form's own when set, else the storefront's. */
export function feesFor(form: Pick<FormSettings, 'handlingFee' | 'packagingFee'> | undefined, s: Pick<Settings, 'storefront'>): { handlingFee: number; packagingFee: number } {
  const base = shippingOf(s);
  return {
    handlingFee: validFee(form?.handlingFee) ?? base.handlingFee,
    packagingFee: validFee(form?.packagingFee) ?? base.packagingFee,
  };
}

/** Grams of one unit of a variant: its own weight, else the item's. */
function variantWeight(item: Item, variantId: string): number | undefined {
  const v = variantId === DEFAULT_VARIANT_ID ? undefined : item.variants.find((x) => x.id === variantId);
  return validWeight(v?.weightGrams) ?? validWeight(item.weightGrams);
}

/**
 * Grams of one unit of an orderable key (`itemId:variantId`, or a bundle's item id), or undefined
 * when the catalogue has no weight for it. A bundle without its own weight adds up its components;
 * a component the customer chooses counts as its heaviest allowed variant.
 */
export function weightOfKey(key: string, itemsById: Map<string, Item>): number | undefined {
  if (key.includes(':')) {
    const { itemId, variantId } = splitKey(key);
    const item = itemsById.get(itemId);
    return item ? variantWeight(item, variantId) : undefined;
  }
  const item = itemsById.get(key);
  if (!item) return undefined;
  if (item.kind !== 'bundle') return variantWeight(item, DEFAULT_VARIANT_ID);
  const own = validWeight(item.weightGrams);
  if (own) return own;
  if (item.components.length === 0) return undefined;
  let sum = 0;
  for (const c of item.components) {
    const comp = itemsById.get(c.itemId);
    if (!comp) return undefined;
    const ids = c.variantId ? [c.variantId] : c.allowedVariantIds?.length ? c.allowedVariantIds : [DEFAULT_VARIANT_ID];
    const ws = ids.map((id) => variantWeight(comp, id));
    if (ws.some((w) => w === undefined)) return undefined;
    sum += Math.max(...(ws as number[])) * c.qty;
  }
  return sum;
}

/** A unit the catalogue has no weight for counts as this much; the order is flagged for staff. */
export const UNKNOWN_UNIT_GRAMS = 100;

/**
 * Parcel weight of a cart: units times weight, plus packing. Keys without a weight count as
 * UNKNOWN_UNIT_GRAMS per unit and are listed in `missing`.
 */
export function parcelGrams(lines: Record<string, number>, weightOf: (key: string) => number | undefined): { grams: number; missing: string[] } {
  let grams = PACKING_GRAMS;
  const missing: string[] = [];
  for (const [key, qty] of Object.entries(lines)) {
    const n = Math.max(0, Math.round(Number(qty) || 0));
    if (n === 0) continue;
    const w = weightOf(key);
    if (w === undefined) missing.push(key);
    grams += (w ?? UNKNOWN_UNIT_GRAMS) * n;
  }
  return { grams, missing };
}

/**
 * Kilograms Lion Parcel charges for a parcel: at least 1, a remainder above 300 g rounds up.
 * Weights go to the nearest 10 g first, as Biteship does (1,301 g is 1 kg, 1,310 g is 2 kg).
 */
export function billedKg(grams: number): number {
  const g = Math.round(Math.max(0, grams) / 10) * 10;
  const whole = Math.floor(g / 1000);
  return Math.max(1, g - whole * 1000 > TOLERANCE_GRAMS ? whole + 1 : whole);
}

/** "1,2 kg" style label for customers. */
export const formatKg = (grams: number): string => `${(Math.round(grams / 100) / 10).toLocaleString('id-ID')} kg`;

/** Names of the items with a published key (the item or one of its variants) without a weight. */
export function unweighedLabels(items: Record<string, { name: string; variantName: string; weight?: number }>): string[] {
  return [...new Set(Object.values(items).filter((x) => !validWeight(x.weight)).map((x) => x.name))];
}

/** A short publish warning, or '' when every item has a weight. */
export function unweighedWarning(names: string[]): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return `${names.length === 1 ? '1 item has' : `${names.length} items have`} no weight yet (${shown}${more}). Shipping counts each unit as ${UNKNOWN_UNIT_GRAMS} g and flags the order; add weights in the catalogue or the storefront's Shipping tab.`;
}

// ---- Quotes (used by the quoteShipping callable and, later, the import) ----

/** How long a quote is honoured, and how long a courier price is reused for the same route and weight. */
export const QUOTE_TTL_MS = 24 * 60 * 60 * 1000;
export const RATE_CACHE_MS = 24 * 60 * 60 * 1000;

/** The courier and the services offered, with the names customers see. Lion Parcel only for now. */
export const SHIPPING_COURIER = 'lion';
export const SHIPPING_SERVICES: Record<string, string> = { reg_pack: 'Lion REGPACK', boss_pack: 'Lion BOSSPACK' };

/** An Indonesian postcode: five digits, not starting with 0. */
export const validPostalCode = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{4}$/.test(v);

/**
 * A cart checked against the published form it came from: only offered keys, whole quantities
 * from 1 to the form's limit. Weights are the published ones, so the price follows what the
 * customer saw. Returns an error message instead when the cart cannot be priced.
 */
export function parcelForForm(pf: Pick<PublicForm, 'items' | 'maxQtyPerLine'>, raw: unknown): { lines: Record<string, number>; grams: number; billedKg: number; unweighed: string[] } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The cart is empty.' };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 60) return { error: entries.length === 0 ? 'The cart is empty.' : 'Too many lines in the cart.' };
  const max = Math.max(1, Math.min(99, pf.maxQtyPerLine || 20));
  const lines: Record<string, number> = {};
  for (const [key, q] of entries) {
    const item = pf.items[key];
    if (!item) return { error: 'An item in the cart is no longer on offer. Refresh the page.' };
    const qty = Math.round(Number(q));
    if (!Number.isFinite(qty) || qty < 1) continue;
    lines[key] = Math.min(max, qty);
  }
  if (Object.keys(lines).length === 0) return { error: 'The cart is empty.' };
  const { grams, missing } = parcelGrams(lines, (k) => validWeight(pf.items[k]?.weight));
  return { lines, grams, billedKg: billedKg(grams), unweighed: [...new Set(missing.map((k) => pf.items[k].name))] };
}

/** One row of Biteship's rates answer, as far as the quote needs it. */
export interface CourierRate { courier_code?: string; courier_service_code?: string; price?: number; duration?: string }

/** The offered services from a rates answer, cheapest first. */
export function optionsFromRates(pricing: CourierRate[] | undefined): ShippingOption[] {
  return (pricing ?? [])
    .filter((p) => p.courier_code === SHIPPING_COURIER && !!p.courier_service_code && p.courier_service_code in SHIPPING_SERVICES && typeof p.price === 'number' && p.price > 0)
    .map((p) => ({ courier: SHIPPING_COURIER, service: p.courier_service_code as string, name: SHIPPING_SERVICES[p.courier_service_code as string], price: Math.round(p.price as number), etd: (p.duration ?? '').trim() }))
    .sort((a, b) => a.price - b.price);
}

// ---- Import: charging what the checkout quoted ----

/** The shipping on an order from one chosen courier service. */
export function orderShippingFrom(option: ShippingOption, fees: { handlingFee: number; packagingFee: number }, parcel: { grams: number; billedKg: number }, postalCode: string, quotedAt: number, quoteId?: string, requoted?: boolean): OrderShipping {
  return {
    courier: option.courier, service: option.service, name: option.name, fee: option.price,
    handlingFee: fees.handlingFee, packagingFee: fees.packagingFee, grams: parcel.grams, billedKg: parcel.billedKg,
    postalCode, quotedAt, ...(quoteId ? { quoteId } : {}), ...(requoted ? { requoted: true } : {}),
  };
}

/** Shipping, handling and packaging together: what shipping adds to an order's total. */
export const shippingTotal = (s: Pick<OrderShipping, 'fee' | 'handlingFee' | 'packagingFee'> | undefined): number =>
  s ? s.fee + s.handlingFee + s.packagingFee : 0;

export type ShippingResolution =
  /** Not a shipped order with a quote: nothing to charge. */
  | { kind: 'none' }
  | { kind: 'ok'; shipping: OrderShipping; unweighed: string[] }
  /** The quote does not fit the submission (missing, expired, other postcode or weight): price it again. */
  | { kind: 'requote'; reason: string; postalCode: string; service: string; grams: number; billedKg: number; unweighed: string[] }
  | { kind: 'flag'; flag: string };

/**
 * Checks a shipped submission against the quote it carries. The quote is honoured when it belongs
 * to the same customer and form, has the same postcode and billed kilograms, offers the chosen
 * service, and the submission arrived before it expired. Weights are the published form's.
 */
export function resolveShipping(input: {
  sub: Pick<Submission, 'fulfilment' | 'formId' | 'lines' | 'postalCode' | 'shipping' | 'customerUid'>;
  submittedAt: number;
  pf: Pick<PublicForm, 'items' | 'maxQtyPerLine'> | null;
  quote: ShippingQuote | null;
}): ShippingResolution {
  const { sub, pf, quote, submittedAt } = input;
  if (sub.fulfilment !== 'mail') return { kind: 'none' };
  if (!sub.shipping || !sub.postalCode) return { kind: 'flag', flag: 'No shipping was charged on this mail order. Agree the shipping fee with the customer.' };
  if (!pf) return { kind: 'flag', flag: 'Shipping could not be checked (the form is gone). Agree the shipping fee with the customer.' };
  const parcel = parcelForForm(pf, sub.lines);
  if ('error' in parcel) return { kind: 'flag', flag: `Shipping could not be priced: ${parcel.error}` };
  const requote = (reason: string): ShippingResolution => ({ kind: 'requote', reason, postalCode: sub.postalCode as string, service: sub.shipping!.service, grams: parcel.grams, billedKg: parcel.billedKg, unweighed: parcel.unweighed });
  if (!quote) return requote('the quote was not found');
  if (quote.uid !== sub.customerUid || quote.formId !== sub.formId) return requote('the quote belongs to another checkout');
  if (quote.postalCode !== sub.postalCode) return requote('the postcode changed');
  if (quote.billedKg !== parcel.billedKg) return requote('the parcel weight changed');
  if (submittedAt > quote.expiresAt) return requote('the quote expired');
  const option = quote.options.find((o) => o.service === sub.shipping!.service);
  if (!option) return requote('the chosen service was not in the quote');
  return { kind: 'ok', unweighed: parcel.unweighed, shipping: orderShippingFrom(option, quote, parcel, quote.postalCode, quote.createdAt, sub.shipping.quoteId) };
}

/** The staff note for items charged at the stand-in weight. */
export const unweighedFlag = (names: string[]): string =>
  names.length ? `No weight for ${names.join(', ')}: shipping counted ${UNKNOWN_UNIT_GRAMS} g each. Check the parcel weight.` : '';
