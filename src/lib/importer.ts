// Turns a customer submission into an order. Runs in the staff browser inside one Firestore
// transaction so two staff members importing at once cannot double-import or share a sequence
// number. Prices come from the batch offering, never from the customer.
import { doc, runTransaction } from 'firebase/firestore';
import { db } from './firebase';
import { COL, allocateTransactionId, clean, logActivity } from './repo';
import { expandLines } from './bundle';
import { offeringKey } from './forms';
import { DEFAULT_VARIANT_ID, splitKey, variantLabel } from './keys';
import { catalogPrice, orderTypeForBatch, quote, storefrontOf, type CatalogPrice } from './pricing';
import { PUBLIC_PRICES_ID } from './prices';
import { isStoreLaneId, MAIL_LANE_BATCH, monthBatchFor } from './store';
import type { Batch, Event, Item, Order, OrderType, PublicPrices, RawLine, Settings, Submission } from '@/types';

export type ImportResult = 'imported' | 'rejected' | 'skipped';

export interface ImportContext {
  batches: Batch[];
  events: Event[];
  itemsById: Map<string, Item>;
  settings: Settings;
}

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

export async function importSubmission(subId: string, ctx: ImportContext, by: string): Promise<ImportResult> {
  let createdTid = '';
  let createdOrderId = '';
  let capturedCode: string | undefined;
  let previousStatus = 'new';

  const res = await runTransaction(db, async (tx) => {
    const subRef = doc(db, COL.submissions, subId);
    const snap = await tx.get(subRef);
    if (!snap.exists()) return 'skipped';
    const sub = { id: snap.id, ...(snap.data() as Omit<Submission, 'id'>) };
    capturedCode = sub.code;
    previousStatus = sub.status;
    if (sub.status !== 'new') return 'skipped';

    // Storefront mail orders are filed under the mail-order channel's batch for the month they came in.
    const isMail = sub.batchId === MAIL_LANE_BATCH;
    const at = submissionTime(sub);
    let batch = isMail ? undefined : ctx.batches.find((b) => b.id === sub.batchId);
    const event = isMail ? ctx.events.find((e) => e.id === sub.eventId && e.kind === 'store') : batch ? ctx.events.find((e) => e.id === batch!.eventId) : undefined;
    let newMonthBatch: Omit<Batch, 'id'> | null = null;
    if (isMail && event) {
      const month = monthBatchFor(at);
      const ref = doc(db, COL.batches, month.id);
      const snap = await tx.get(ref);
      if (snap.exists()) batch = { id: snap.id, ...(snap.data() as Omit<Batch, 'id'>) };
      else {
        const now = Date.now();
        newMonthBatch = {
          eventId: event.id, number: month.number, mode: 'post', status: 'open', opensAt: '', closesAt: '', offering: [], planning: {}, storefront: false,
          createdAt: now, updatedAt: now, updatedBy: by,
        };
        batch = { id: month.id, ...newMonthBatch };
      }
    }
    if (!batch || !event) {
      tx.update(subRef, { status: 'rejected', rejectReason: 'Batch or event no longer exists' });
      return 'rejected';
    }
    const priceSnap = await tx.get(doc(db, COL.publicPrices, PUBLIC_PRICES_ID));
    const live = priceSnap.exists() ? (priceSnap.data() as PublicPrices) : null;
    const orderType: OrderType = event.kind === 'store' ? 'mail_order' : orderTypeForBatch(batch);
    const { lines: rawLines, changed } = rawLinesFromSubmission(sub, batch, ctx.itemsById, live, ctx.settings, orderType);
    if (rawLines.length === 0) {
      tx.update(subRef, { status: 'rejected', rejectReason: 'No valid items on the submission' });
      return 'rejected';
    }

    const tid = await allocateTransactionId(tx, batch, event);
    if (newMonthBatch) tx.set(doc(db, COL.batches, batch.id), newMonthBatch);
    const fulfilment: Order['fulfilment'] = batch.mode === 'post' ? 'mail' : sub.fulfilment === 'mail' ? 'mail' : 'pickup';
    const now = Date.now();
    const orderId = doc(db, COL.orders).id;
    createdTid = tid;
    createdOrderId = orderId;
    const order: Omit<Order, 'id'> = {
      eventId: batch.eventId, batchId: batch.id, source: isStoreLaneId(sub.formId) ? 'store' : 'web', externalId: sub.id, transactionId: tid,
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
      rawLines, lines: expandLines(rawLines, ctx.itemsById), total: rawLines.reduce((s, l) => s + l.lineTotal, 0),
      notes: (sub.notes ?? '').trim() ? `Customer note: ${sub.notes.trim()}` : '',
      createdAt: now, updatedAt: now, updatedBy: by,
    };
    tx.set(doc(db, COL.orders, orderId), clean(order));
    tx.update(subRef, { status: 'imported', orderId });
    return 'imported';
  });

  if (res === 'imported' && createdTid) {
    await logActivity('create', 'order', `Imported submission into order ${createdTid}`, by, { entityId: createdOrderId, entityName: createdTid });
  } else if (res === 'rejected') {
    const subLabel = capturedCode ? `Submission ${capturedCode}` : undefined;
    await logActivity('update', 'submission', `Rejected invalid submission${capturedCode ? ` (${capturedCode})` : ''}`, by, {
      entityId: subId,
      entityName: subLabel,
      changes: [{ field: 'status', before: previousStatus, after: 'rejected' }],
    });
  }

  return res;
}
