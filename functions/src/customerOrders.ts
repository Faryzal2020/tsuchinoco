// The customer's copy of each order, customerOrders/{token}.
// - ensureCustomerToken: gives an order its secret token once (128 random bits). The order page
//   link in the "Payment confirmed" e-mail carries it; anyone with the link can read that copy.
// - mirrorCustomerOrder: rewrites the copy whenever something the customer sees changes, and
//   removes it when the order is deleted. The copy has no address, phone or e-mail.
import { randomBytes } from 'crypto';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { clean, db, getSettings, TRIGGER_REGION } from './common';
import { customerOrderView, customerViewKey } from '../../src/lib/customerOrders';
import type { Batch, Event, Item, Order } from '../../src/types';

/** The order's token, creating it on first use. Safe to call from several triggers at once. */
export async function ensureCustomerToken(orderId: string): Promise<string> {
  const ref = db().doc(`orders/${orderId}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.data()?.customerToken as string | undefined;
    if (existing) return existing;
    const token = randomBytes(16).toString('base64url');
    tx.update(ref, { customerToken: token });
    return token;
  });
}

async function loadItems(ids: string[]): Promise<Map<string, Item>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, Item>();
  if (unique.length === 0) return out;
  const snaps = await db().getAll(...unique.map((id) => db().doc(`items/${id}`)));
  for (const s of snaps) if (s.exists) out.set(s.id, { id: s.id, ...(s.data() as Omit<Item, 'id'>) });
  return out;
}

/** Writes the customer copy of one order. */
export async function writeCustomerCopy(order: Order, token: string): Promise<void> {
  const [eventSnap, batchSnap, itemsById, settings] = await Promise.all([
    db().doc(`events/${order.eventId}`).get(), db().doc(`batches/${order.batchId}`).get(),
    loadItems(order.rawLines.map((l) => l.itemId)), getSettings(),
  ]);
  const view = customerOrderView(order, {
    event: eventSnap.exists ? ({ id: eventSnap.id, ...eventSnap.data() } as Event) : undefined,
    batch: batchSnap.exists ? ({ id: batchSnap.id, ...batchSnap.data() } as Batch) : undefined,
    itemsById, currency: settings.currency || 'IDR',
  });
  await db().doc(`customerOrders/${token}`).set(clean(view));
}

export const mirrorCustomerOrder = onDocumentWritten({ document: 'orders/{id}', region: TRIGGER_REGION }, async (ev) => {
  const before = ev.data?.before.exists ? ({ id: ev.data.before.id, ...ev.data.before.data() } as Order) : null;
  const after = ev.data?.after.exists ? ({ id: ev.data.after.id, ...ev.data.after.data() } as Order) : null;
  try {
    if (!after) {
      if (before?.customerToken) await db().doc(`customerOrders/${before.customerToken}`).delete();
      return;
    }
    // Staff-only changes (notes, e-mail log, flags) leave the customer copy as it is.
    if (before && after.customerToken && customerViewKey(before) === customerViewKey(after)) return;
    // A new token is written to the order, which fires this trigger again; that run writes the copy.
    if (!after.customerToken) { await ensureCustomerToken(after.id); return; }
    await writeCustomerCopy(after, after.customerToken);
  } catch (e) {
    logger.error('[customer-order] mirror failed', ev.params.id, e);
  }
});
