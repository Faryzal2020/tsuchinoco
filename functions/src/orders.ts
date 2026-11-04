// Server side of the order flow.
// - importSubmissionOnCreate: turns each new Form or storefront submission into an order the moment
//   it arrives, so orders no longer wait for a staff member to have the app open. Same pure code
//   and same transaction shape as the staff browser's importer (src/lib/importer.ts), which stays
//   as a fallback; whichever runs first wins and the other sees the submission is no longer new.
// - orderEmailsOnWrite: sends the order-update e-mails staff switched on (received, paid,
//   delivered) and records each one on the order.
// - resendOrderEmail: "Send again" from the order view.
import { getFirestore, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { Resend } from 'resend';
import { buildImportedOrder, importTarget, itemIdsOf, newMonthBatch } from '../../src/lib/importCore';
import { transactionId } from '../../src/lib/forms';
import { emailRef, emailsDue, NOTIFICATION_TYPES, notificationsOf, orderEmailVars, renderEmail, templateFor } from '../../src/lib/orderEmail';
import type { Batch, Event, Item, NotificationType, Order, OrderEmail, PublicPrices, Settings, Submission } from '../../src/types';

// Firestore triggers must run in the database's region. Set FIRESTORE_REGION in functions/.env if
// the database is not in asia-southeast1; a mismatch makes the deploy fail with a clear message.
const TRIGGER_REGION = process.env.FIRESTORE_REGION || 'asia-southeast1';
const SYSTEM = 'system';

const db = () => getFirestore();

/** Firestore rejects undefined; strip it recursively. */
function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as T;
  if (v && typeof v === 'object' && !(v instanceof FieldValue)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = clean(x);
    return out as T;
  }
  return v;
}

async function logActivity(action: string, entityType: string, details: string, extra: { entityId?: string; entityName?: string } = {}) {
  try {
    await db().collection('logs').add(clean({ action, entityType, details, ...extra, createdAt: Date.now(), createdBy: SYSTEM }));
  } catch (e) {
    logger.warn('[log] could not write', e);
  }
}

async function getSettings(): Promise<Settings> {
  const s = await db().doc('settings/global').get();
  return (s.exists ? s.data() : {}) as Settings;
}

/** Items a set of lines needs, plus the components of any bundle among them. */
async function loadItems(ids: string[]): Promise<Map<string, Item>> {
  const out = new Map<string, Item>();
  const fetch = async (want: string[]) => {
    const todo = want.filter((id) => id && !out.has(id));
    if (todo.length === 0) return;
    const snaps = await db().getAll(...todo.map((id) => db().doc(`items/${id}`)));
    for (const s of snaps) if (s.exists) out.set(s.id, { id: s.id, ...(s.data() as Omit<Item, 'id'>) });
  };
  await fetch(ids);
  await fetch([...out.values()].filter((i) => i.kind === 'bundle').flatMap((i) => i.components.map((c) => c.itemId)));
  return out;
}

const dataOf = <T>(snap: FirebaseFirestore.DocumentSnapshot): T | undefined => (snap.exists ? ({ id: snap.id, ...snap.data() } as T) : undefined);

export const importSubmissionOnCreate = onDocumentCreated({ document: 'submissions/{id}', region: TRIGGER_REGION }, async (ev) => {
  const id = ev.params.id;
  const first = ev.data?.data() as Omit<Submission, 'id'> | undefined;
  if (!first || first.status !== 'new') return;
  const [settings, itemsById] = await Promise.all([getSettings(), loadItems(itemIdsOf(first.lines))]);
  const subRef = db().doc(`submissions/${id}`);

  let result = 'skipped' as 'imported' | 'rejected' | 'skipped';
  let tid = '';
  let orderId = '';
  let reason = '';
  await db().runTransaction(async (tx: Transaction) => {
    const subSnap = await tx.get(subRef);
    const sub = dataOf<Submission>(subSnap);
    if (!sub || sub.status !== 'new') { result = 'skipped'; return; }

    const target = importTarget(sub);
    let batch: Batch | undefined;
    let event: Event | undefined;
    let monthBatch: Omit<Batch, 'id'> | null = null;
    if (target.mail) {
      const e = dataOf<Event>(await tx.get(db().doc(`events/${sub.eventId}`)));
      event = e?.kind === 'store' ? e : undefined;
      if (event) {
        batch = dataOf<Batch>(await tx.get(db().doc(`batches/${target.monthId}`)));
        if (!batch) { monthBatch = newMonthBatch(event, target.monthNumber, Date.now(), SYSTEM); batch = { id: target.monthId, ...monthBatch }; }
      }
    } else {
      batch = dataOf<Batch>(await tx.get(db().doc(`batches/${target.batchId}`)));
      if (batch) event = dataOf<Event>(await tx.get(db().doc(`events/${batch.eventId}`)));
    }
    if (!batch || !event) {
      reason = 'Batch or event no longer exists';
      tx.update(subRef, { status: 'rejected', rejectReason: reason });
      result = 'rejected';
      return;
    }
    const live = (await tx.get(db().doc('publicPrices/current'))).data() as PublicPrices | undefined;
    const counterRef = db().doc(`counters/${batch.id}`);
    const counter = await tx.get(counterRef);

    const now = Date.now();
    const probe = buildImportedOrder({ sub, batch, event, itemsById, live: live ?? null, settings, transactionId: '', now, by: SYSTEM });
    if ('reject' in probe) {
      reason = probe.reject;
      tx.update(subRef, { status: 'rejected', rejectReason: reason });
      result = 'rejected';
      return;
    }
    const next = counter.exists ? Number(counter.data()?.next) || 1 : 1;
    tx.set(counterRef, { next: next + 1 });
    if (monthBatch) tx.set(db().doc(`batches/${batch.id}`), monthBatch);
    tid = transactionId(event, batch, next);
    const orderRef = db().collection('orders').doc();
    orderId = orderRef.id;
    tx.set(orderRef, clean({ ...probe.order, transactionId: tid }));
    tx.update(subRef, { status: 'imported', orderId });
    result = 'imported';
  });

  if (result === 'imported') await logActivity('create', 'order', `Imported submission into order ${tid}`, { entityId: orderId, entityName: tid });
  if (result === 'rejected') await logActivity('update', 'submission', `Rejected invalid submission (${first.code}): ${reason}`, { entityId: id, entityName: `Submission ${first.code}` });
});

/** Send one order-update e-mail and describe the outcome. Never throws. */
async function sendOrderEmail(order: Order, type: NotificationType, settings: Settings, ref: number, by?: string): Promise<OrderEmail> {
  const to = (order.customer?.email ?? '').trim();
  const base: OrderEmail = { type, to, at: Date.now(), ok: false, ref, ...(by ? { by } : {}) };
  if (!to) return { ...base, error: 'No e-mail address on the order.' };
  const key = settings.resendApiKey?.trim() || process.env.RESEND_API_KEY;
  const fromEmail = settings.resendFromEmail?.trim();
  if (!key || !fromEmail) return { ...base, error: 'E-mail is not set up: add the Resend key and sender on the Emails page.' };
  try {
    const [eventSnap, batchSnap, itemsById] = await Promise.all([
      db().doc(`events/${order.eventId}`).get(), db().doc(`batches/${order.batchId}`).get(), loadItems(order.rawLines.map((l) => l.itemId)),
    ]);
    const vars = orderEmailVars(order, { event: dataOf<Event>(eventSnap), batch: dataOf<Batch>(batchSnap), itemsById, currency: settings.currency || 'IDR' });
    const { subject, html } = renderEmail(templateFor(type, settings), vars);
    const from = settings.resendFromName?.trim() ? `${settings.resendFromName.trim()} <${fromEmail}>` : fromEmail;
    const res = await new Resend(key).emails.send({
      from, to: order.customer.name ? `${order.customer.name} <${to}>` : to, subject, html, replyTo: settings.resendReplyTo?.trim() || undefined,
    });
    if (res.error) return { ...base, error: res.error.message };
    return { ...base, ok: true, id: res.data?.id };
  } catch (e) {
    logger.error('[order-email]', order.id, type, e);
    return { ...base, error: e instanceof Error ? e.message : 'Send failed' };
  }
}

export const orderEmailsOnWrite = onDocumentWritten({ document: 'orders/{id}', region: TRIGGER_REGION }, async (ev) => {
  const change = ev.data;
  if (!change?.after.exists) return;
  const after = { id: change.after.id, ...change.after.data() } as Order;
  const before = change.before.exists ? ({ id: change.before.id, ...change.before.data() } as Order) : null;
  const due = emailsDue(before, after);
  const skip = after.skipEmail ?? [];
  if (due.length === 0 && skip.length === 0) return;

  const settings = await getSettings();
  const switches = notificationsOf(settings);
  const entries: OrderEmail[] = [];
  for (const type of due) {
    const ref = emailRef(after, type);
    if ((after.emails ?? []).some((e) => e.type === type && e.ref === ref && !e.by)) continue; // a retry: already handled
    if (!switches[type].on) continue;
    if (skip.includes(type)) { entries.push({ type, to: after.customer?.email ?? '', at: Date.now(), ok: false, skipped: true, ref }); continue; }
    entries.push(await sendOrderEmail(after, type, settings, ref));
  }
  const update: Record<string, unknown> = {};
  if (entries.length > 0) update.emails = FieldValue.arrayUnion(...entries.map((e) => clean(e)));
  if (skip.length > 0) update.skipEmail = FieldValue.delete();
  if (Object.keys(update).length > 0) await change.after.ref.update(update);
});

export const resendOrderEmail = onCall({ invoker: 'public', cors: true }, async (req) => {
  const email = req.auth?.token.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', 'Sign in first.');
  const staff = await db().doc(`staff/${email}`).get();
  if (!staff.exists || staff.data()?.active !== true) throw new HttpsError('permission-denied', 'Not an active staff account.');
  const { orderId, type } = (req.data ?? {}) as { orderId?: string; type?: NotificationType };
  if (!orderId || !type || !NOTIFICATION_TYPES.includes(type)) throw new HttpsError('invalid-argument', 'orderId and a valid type are required.');
  const ref = db().doc(`orders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
  const order = { id: snap.id, ...snap.data() } as Order;
  const entry = await sendOrderEmail(order, type, await getSettings(), emailRef(order, type), email);
  await ref.update({ emails: FieldValue.arrayUnion(clean(entry)) });
  return entry;
});
