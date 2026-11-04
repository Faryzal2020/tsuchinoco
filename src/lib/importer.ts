// Turns a customer submission into an order in the staff browser. Normally the Cloud Function
// (functions/src/index.ts) does this the moment a submission arrives; this is the fallback for
// submissions it has not picked up after a couple of minutes. Both run the same pure code in
// importCore.ts inside one transaction, so a submission can never become two orders.
import { doc, runTransaction } from 'firebase/firestore';
import { db } from './firebase';
import { COL, allocateTransactionId, clean, logActivity } from './repo';
import { PUBLIC_PRICES_ID } from './prices';
import { buildImportedOrder, importTarget, newMonthBatch } from './importCore';
import type { Batch, Event, Item, PublicPrices, Settings, Submission } from '@/types';

export { rawLinesFromSubmission, submissionTime } from './importCore';

export type ImportResult = 'imported' | 'rejected' | 'skipped';

export interface ImportContext {
  batches: Batch[];
  events: Event[];
  itemsById: Map<string, Item>;
  settings: Settings;
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
    const target = importTarget(sub);
    let batch = target.mail ? undefined : ctx.batches.find((b) => b.id === target.batchId);
    const event = target.mail ? ctx.events.find((e) => e.id === sub.eventId && e.kind === 'store') : batch ? ctx.events.find((e) => e.id === batch!.eventId) : undefined;
    let monthBatch: Omit<Batch, 'id'> | null = null;
    if (target.mail && event) {
      const snap = await tx.get(doc(db, COL.batches, target.monthId));
      if (snap.exists()) batch = { id: snap.id, ...(snap.data() as Omit<Batch, 'id'>) };
      else { monthBatch = newMonthBatch(event, target.monthNumber, Date.now(), by); batch = { id: target.monthId, ...monthBatch }; }
    }
    if (!batch || !event) {
      tx.update(subRef, { status: 'rejected', rejectReason: 'Batch or event no longer exists' });
      return 'rejected';
    }
    const priceSnap = await tx.get(doc(db, COL.publicPrices, PUBLIC_PRICES_ID));
    const live = priceSnap.exists() ? (priceSnap.data() as PublicPrices) : null;
    // Price before allocating a number, so a rejected submission does not use one up.
    const probe = buildImportedOrder({ sub, batch, event, itemsById: ctx.itemsById, live, settings: ctx.settings, transactionId: '', now: Date.now(), by });
    if ('reject' in probe) {
      tx.update(subRef, { status: 'rejected', rejectReason: probe.reject });
      return 'rejected';
    }
    const tid = await allocateTransactionId(tx, batch, event);
    if (monthBatch) tx.set(doc(db, COL.batches, batch.id), monthBatch);
    const orderId = doc(db, COL.orders).id;
    createdTid = tid;
    createdOrderId = orderId;
    tx.set(doc(db, COL.orders, orderId), clean({ ...probe.order, transactionId: tid }));
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
