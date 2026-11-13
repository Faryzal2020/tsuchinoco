// Pure part of turning a customer submission into an order: line pricing, the order document and
// the mail-order month batch. No Firebase imports, so both the staff browser (importer.ts) and the
// Cloud Function (functions/src/index.ts) run exactly this code. Value imports are relative so
// plain Node can load the compiled output.
import { expandLines } from './bundle';
import { offeringKey } from './forms';
import { DEFAULT_VARIANT_ID, splitKey, variantLabel } from './keys';
import { catalogPrice, orderTypeForBatch, quote, storefrontOf, type CatalogPrice } from './pricing';
import { isStoreLaneId, MAIL_LANE_BATCH, monthBatchFor } from './store';
import { shippingTotal } from './shipping';
import type { Batch, Event, Item, Order, OrderShipping, OrderType, PublicPrices, RawLine, Settings, Submission } from '../types';

/** Server time of the submission when the rules recorded it, else the customer's clock. */
export function submissionTime(sub: Pick<Submission, 'createdAt' | 'submittedAt'>): number {
  const c = sub.createdAt as { toMillis?: () => number } | undefined;
  if (c && typeof c.toMillis === 'function') return c.toMillis();
  return Number(sub.submittedAt) || Date.now();
}

const MAX_QTY = 99;

export interface PricedLines {
  lines: RawLine[];
  /** Labels of lines charged at a different price than the customer saw. */
  changed: string[];
}

/**
 * Price each submitted line. Prices never come from the customer. With a live price list:
 * - the entry the customer saw is charged if it is current, or if it was replaced no more than
 *   the grace period before the submission (or after it);
 * - without a seen entry, the entry in force at submission time is charged;
 * - otherwise the current entry is charged and the line is reported in `changed`.
 * Without a list (before the first price sync) the catalogue price is used.
 */
export function rawLinesFromSubmission(
  sub: Pick<Submission, 'lines' | 'seen' | 'createdAt' | 'submittedAt'>,
  batch: Batch,
  itemsById: Map<string, Item>,
  live: PublicPrices | null,
  settings: Pick<Settings, 'storefront'>,
  orderType: OrderType = orderTypeForBatch(batch),
): PricedLines {
  const out: RawLine[] = [];
  const changed: string[] = [];
  const offered = new Map(batch.offering.map((e) => [offeringKey(e), e]));
  const basis = live?.basis ?? storefrontOf(settings).priceBasis;
  const graceMs = (live?.graceMinutes ?? storefrontOf(settings).graceMinutes) * 60_000;
  const at = submissionTime(sub);
  for (const [key, q] of Object.entries(sub.lines ?? {})) {
    const qty = Math.min(MAX_QTY, Math.round(Number(q)));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const entry = offered.get(key);
    const isBundle = !key.includes(':');
    const { itemId, variantId } = isBundle ? { itemId: key, variantId: undefined } : splitKey(key);
    const item = itemsById.get(itemId);
    if (!item) continue;
    if (!isBundle && variantId !== DEFAULT_VARIANT_ID && !item.variants.some((v) => v.id === variantId)) continue;
    let price: CatalogPrice = catalogPrice(item, key);
    let priceEntryId: string | undefined;
    const lp = live?.items?.[key];
    if (lp) {
      const seen = sub.seen?.[key];
      const prevValid = !!lp.prev && at - lp.since <= graceMs;
      if (seen && seen === lp.entryId) { price = lp; priceEntryId = lp.entryId; }
      else if (seen && lp.prev && seen === lp.prev.entryId && prevValid) { price = lp.prev; priceEntryId = lp.prev.entryId; }
      else if (!seen && lp.prev && at < lp.since) { price = lp.prev; priceEntryId = lp.prev.entryId; }
      else {
        price = lp; priceEntryId = lp.entryId;
        if (seen) changed.push(variantLabel(item, variantId ?? DEFAULT_VARIANT_ID));
      }
    }
    const quoted = quote(price, orderType, basis, entry?.overridePrice);
    out.push({
      itemId, variantId: isBundle ? undefined : variantId, qty, unitPrice: quoted.unitPrice, lineTotal: quoted.unitPrice * qty,
      priceEntryId, priceBasis: quoted.basis, discountPercent: quoted.discountPercent, refPrice: quoted.refPrice,
    });
  }
  return { lines: out, changed };
}


/** Where a submission is filed: its batch, or for storefront mail orders the channel's month batch. */
export function importTarget(sub: Pick<Submission, 'batchId' | 'eventId' | 'createdAt' | 'submittedAt'>): { mail: true; monthId: string; monthNumber: number } | { mail: false; batchId: string } {
  if (sub.batchId === MAIL_LANE_BATCH) { const m = monthBatchFor(submissionTime(sub)); return { mail: true, monthId: m.id, monthNumber: m.number }; }
  return { mail: false, batchId: sub.batchId };
}

/** A new month batch of the mail-order channel, created by the first mail order of the month. */
export function newMonthBatch(event: Event, number: number, now: number, by: string): Omit<Batch, 'id'> {
  return { eventId: event.id, number, mode: 'post', status: 'open', opensAt: '', closesAt: '', offering: [], planning: {}, storefront: false, createdAt: now, updatedAt: now, updatedBy: by };
}

/** The order a submission becomes, or why it is rejected. */
export function buildImportedOrder(input: {
  sub: Submission; batch: Batch; event: Event; itemsById: Map<string, Item>; live: PublicPrices | null;
  settings: Pick<Settings, 'storefront'>; transactionId: string; now: number; by: string;
  /** Shipping worked out by the caller (resolveShipping, then a server re-quote if needed). */
  shipping?: { value?: OrderShipping; flag?: string };
}): { order: Omit<Order, 'id'> } | { reject: string } {
  const { sub, batch, event, itemsById, live, settings, now, by } = input;
  const orderType: OrderType = event.kind === 'store' ? 'mail_order' : orderTypeForBatch(batch);
  const { lines: rawLines, changed } = rawLinesFromSubmission(sub, batch, itemsById, live, settings, orderType);
  if (rawLines.length === 0) return { reject: 'No valid items on the submission' };
  const fulfilment: Order['fulfilment'] = batch.mode === 'post' ? 'mail' : sub.fulfilment === 'mail' ? 'mail' : 'pickup';
  const order: Omit<Order, 'id'> = {
    eventId: batch.eventId, batchId: batch.id, source: isStoreLaneId(sub.formId) ? 'store' : 'web', externalId: sub.id, transactionId: input.transactionId,
    paymentMethod: sub.paymentMethod?.trim() || undefined,
    pickupDay: fulfilment === 'pickup' ? sub.pickupDay : undefined,
    paymentProofUrl: sub.paymentProofUrl,
    submittedAt: Number(sub.submittedAt) || now,
    customer: {
      name: (sub.customer?.name ?? '').trim() || 'Unknown',
      email: (sub.customer?.email ?? '').trim(),
      phone: (sub.customer?.phone ?? '').trim(),
      address: (sub.customer?.address ?? '').trim() || undefined,
    },
    fulfilment, status: fulfilment === 'pickup' ? 'awaiting_pickup' : 'awaiting_shipment',
    orderType, payment: 'unpaid',
    priceFlag: changed.length > 0 ? `Price changed during checkout: ${changed.join(', ')}. Confirm the total with the customer.` : undefined,
    rawLines, lines: expandLines(rawLines, itemsById), total: rawLines.reduce((s, l) => s + l.lineTotal, 0),
    notes: (sub.notes ?? '').trim() ? `Customer note: ${sub.notes.trim()}` : '',
    createdAt: now, updatedAt: now, updatedBy: by,
  };
  if (fulfilment === 'mail') {
    const ship = input.shipping?.value;
    if (ship) { order.shipping = ship; order.total += shippingTotal(ship); }
    if (input.shipping?.flag) order.shippingFlag = input.shipping.flag;
    if (sub.customerUid) order.customerUid = sub.customerUid;
  }
  return { order };
}

/** Item ids a submission needs loaded: its lines and, for bundles, their components. */
export function itemIdsOf(lines: Record<string, number>): string[] {
  return [...new Set(Object.keys(lines ?? {}).map((k) => (k.includes(':') ? k.slice(0, k.indexOf(':')) : k)))];
}
