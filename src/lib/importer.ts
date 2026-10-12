// Turns a customer submission into an order. Runs in the staff browser inside one Firestore
// transaction so two staff members importing at once cannot double-import or share a sequence
// number. Prices come from the batch offering, never from the customer.
import { doc, runTransaction } from 'firebase/firestore';
import { db } from './firebase';
import { COL, allocateTransactionId, clean } from './repo';
import { expandLines } from './bundle';
import { entryPrice, offeringKey } from './forms';
import { DEFAULT_VARIANT_ID, splitKey } from './keys';
import type { Batch, Event, Item, Order, RawLine, Submission } from '@/types';

export type ImportResult = 'imported' | 'rejected' | 'skipped';

export interface ImportContext {
  batches: Batch[];
  events: Event[];
  itemsById: Map<string, Item>;
}

const MAX_QTY = 99;

export function rawLinesFromSubmission(lines: Record<string, number>, batch: Batch, itemsById: Map<string, Item>): RawLine[] {
  const out: RawLine[] = [];
  const offered = new Map(batch.offering.map((e) => [offeringKey(e), e]));
  for (const [key, q] of Object.entries(lines ?? {})) {
    const qty = Math.min(MAX_QTY, Math.round(Number(q)));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const entry = offered.get(key);
    const isBundle = !key.includes(':');
    const { itemId, variantId } = isBundle ? { itemId: key, variantId: undefined } : splitKey(key);
    const item = itemsById.get(itemId);
    if (!item) continue;
    if (!isBundle && variantId !== DEFAULT_VARIANT_ID && !item.variants.some((v) => v.id === variantId)) continue;
    const unitPrice = entry ? entryPrice(entry, item) : entryPrice({ itemId, variantId }, item);
    out.push({ itemId, variantId: isBundle ? undefined : variantId, qty, unitPrice, lineTotal: unitPrice * qty });
  }
  return out;
}

export async function importSubmission(subId: string, ctx: ImportContext, by: string): Promise<ImportResult> {
  return runTransaction(db, async (tx) => {
    const subRef = doc(db, COL.submissions, subId);
    const snap = await tx.get(subRef);
    if (!snap.exists()) return 'skipped';
    const sub = { id: snap.id, ...(snap.data() as Omit<Submission, 'id'>) };
    if (sub.status !== 'new') return 'skipped';

    const batch = ctx.batches.find((b) => b.id === sub.batchId);
    const event = batch ? ctx.events.find((e) => e.id === batch.eventId) : undefined;
    if (!batch || !event) {
      tx.update(subRef, { status: 'rejected', rejectReason: 'Batch or event no longer exists' });
      return 'rejected';
    }
    const rawLines = rawLinesFromSubmission(sub.lines, batch, ctx.itemsById);
    if (rawLines.length === 0) {
      tx.update(subRef, { status: 'rejected', rejectReason: 'No valid items on the submission' });
      return 'rejected';
    }

    const tid = await allocateTransactionId(tx, batch, event);
    const fulfilment: Order['fulfilment'] = batch.mode === 'post' ? 'mail' : sub.fulfilment === 'mail' ? 'mail' : 'pickup';
    const now = Date.now();
    const orderId = doc(db, COL.orders).id;
    const order: Omit<Order, 'id'> = {
      eventId: batch.eventId, batchId: batch.id, source: 'web', externalId: sub.id, transactionId: tid,
      pickupDay: fulfilment === 'pickup' ? sub.pickupDay : undefined,
      submittedAt: Number(sub.submittedAt) || now,
      customer: {
        name: (sub.customer?.name ?? '').trim() || 'Unknown',
        email: (sub.customer?.email ?? '').trim(),
        phone: (sub.customer?.phone ?? '').trim(),
        address: (sub.customer?.address ?? '').trim() || undefined,
      },
      fulfilment, status: fulfilment === 'pickup' ? 'awaiting_pickup' : 'awaiting_shipment',
      rawLines, lines: expandLines(rawLines, ctx.itemsById), total: rawLines.reduce((s, l) => s + l.lineTotal, 0),
      notes: (sub.notes ?? '').trim() ? `Customer note: ${sub.notes.trim()}` : '',
      createdAt: now, updatedAt: now, updatedBy: by,
    };
    tx.set(doc(db, COL.orders, orderId), clean(order));
    tx.update(subRef, { status: 'imported', orderId });
    return 'imported';
  });
}
