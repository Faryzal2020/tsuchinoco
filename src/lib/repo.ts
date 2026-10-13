// Firestore writes. Reads are live subscriptions in DataProvider.
import {
  collection,
  deleteDoc,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Transaction,
  type WithFieldValue,
} from 'firebase/firestore';
import { db } from './firebase';
import { newId } from './keys';
import { transactionId } from './forms';
import type {
  Batch, Counter, Event, FormDoc, Item, LogAction, LogEntityType, LogEntry, Media, Order, OrderStatus, PublicForm, Settings, Staff, StockMovement, Submission, Wrapup,
} from '@/types';

export const COL = {
  staff: 'staff',
  items: 'items',
  events: 'events',
  batches: 'batches',
  orders: 'orders',
  movements: 'stockMovements',
  wrapups: 'wrapups',
  settings: 'settings',
  media: 'media',
  forms: 'forms',
  publicForms: 'publicForms',
  submissions: 'submissions',
  counters: 'counters',
  templates: 'formTemplates',
  logs: 'logs',
} as const;

type Meta = { createdAt: number; updatedAt: number; updatedBy: string };

const stamp = (by: string): Meta => ({ createdAt: Date.now(), updatedAt: Date.now(), updatedBy: by });
const touch = (by: string) => ({ updatedAt: Date.now(), updatedBy: by });

/** Firestore rejects undefined; strip it recursively. */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = clean(x);
    return out as T;
  }
  return v;
}

/** Append-only immutable audit log helper */
export async function logActivity(
  action: LogAction,
  entityType: LogEntityType,
  details: string,
  by: string,
  extra?: { entityId?: string; entityName?: string }
): Promise<string> {
  const id = newId();
  try {
    await setDoc(doc(db, COL.logs, id), clean({
      action,
      entityType,
      details,
      entityId: extra?.entityId,
      entityName: extra?.entityName,
      createdAt: Date.now(),
      createdBy: by,
    }));
  } catch (err) {
    console.error('[audit-log] Failed to write log:', err);
  }
  return id;
}

async function create<T extends { id: string }>(col: string, data: Omit<T, 'id' | keyof Meta>, by: string, id = newId()): Promise<string> {
  await setDoc(doc(db, col, id), clean({ ...data, ...stamp(by) }) as WithFieldValue<DocumentData>);
  return id;
}

async function patch(col: string, id: string, data: Record<string, unknown>, by: string) {
  await updateDoc(doc(db, col, id), clean({ ...data, ...touch(by) }));
}

// ---- Staff ----
export const staffRepo = {
  upsert: async (email: string, data: { displayName: string; active: boolean }, by: string) => {
    const id = email.trim().toLowerCase();
    const ref = doc(db, COL.staff, id);
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, { ...data, ...touch(by) });
    else await setDoc(ref, { email: id, ...data, ...stamp(by) });
    await logActivity('update', 'staff', `Upserted staff member ${email} (${data.displayName})`, by, { entityId: id, entityName: data.displayName });
    return id;
  },
  patch: async (id: string, data: Partial<Staff>, by: string) => {
    await patch(COL.staff, id, data, by);
    await logActivity('update', 'staff', `Updated staff member ${id} access`, by, { entityId: id });
  },
};

// ---- Items ----
export const itemRepo = {
  create: async (data: Omit<Item, 'id' | keyof Meta>, by: string, id?: string) => {
    const newIdVal = await create<Item>(COL.items, data, by, id);
    await logActivity('create', 'item', `Created item "${data.name}"`, by, { entityId: newIdVal, entityName: data.name });
    return newIdVal;
  },
  patch: async (id: string, data: Partial<Item>, by: string) => {
    await patch(COL.items, id, data, by);
    const fields = Object.keys(data).filter((k) => k !== 'updatedAt' && k !== 'updatedBy').join(', ');
    await logActivity('update', 'item', `Updated item ${id} (${fields || 'details'})`, by, { entityId: id, entityName: data.name });
  },
  remove: async (id: string, by: string = 'staff') => {
    await deleteDoc(doc(db, COL.items, id));
    await logActivity('delete', 'item', `Deleted item ${id}`, by, { entityId: id });
  },
  bulkCreate: async (rows: Omit<Item, 'id' | keyof Meta>[], by: string) => {
    const chunks: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += 400) chunks.push(rows.slice(i, i + 400));
    for (const chunk of chunks) {
      const b = writeBatch(db);
      for (const r of chunk) b.set(doc(db, COL.items, newId()), clean({ ...r, ...stamp(by) }));
      await b.commit();
    }
    await logActivity('bulk_create', 'item', `Imported / created ${rows.length} catalogue items`, by);
  },
  bulkPatch: async (ids: string[], patchData: Partial<Item>, by: string) => {
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const b = writeBatch(db);
      for (const id of chunk) {
        b.update(doc(db, COL.items, id), clean({ ...patchData, ...touch(by) }));
      }
      await b.commit();
    }
    const fields = Object.keys(patchData).join(', ');
    await logActivity('bulk_update', 'item', `Bulk updated ${ids.length} items (${fields})`, by);
  },
  bulkRemove: async (ids: string[], by: string) => {
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const b = writeBatch(db);
      for (const id of chunk) b.delete(doc(db, COL.items, id));
      await b.commit();
    }
    await logActivity('bulk_delete', 'item', `Deleted ${ids.length} selected items`, by);
  },
  clearAll: async (by: string) => {
    const snap = await getDocs(collection(db, COL.items));
    const count = snap.docs.length;
    for (let i = 0; i < snap.docs.length; i += 400) {
      const chunk = snap.docs.slice(i, i + 400);
      const b = writeBatch(db);
      for (const d of chunk) b.delete(d.ref);
      await b.commit();
    }
    await logActivity('clear', 'item', `Cleared all ${count} items from catalogue`, by);
  },
};

// ---- Events ----
export const eventRepo = {
  create: async (data: Omit<Event, 'id' | keyof Meta>, by: string) => {
    const id = await create<Event>(COL.events, data, by);
    await logActivity('create', 'event', `Created event "${data.name}"`, by, { entityId: id, entityName: data.name });
    return id;
  },
  patch: async (id: string, data: Partial<Event>, by: string) => {
    await patch(COL.events, id, data, by);
    await logActivity('update', 'event', `Updated event ${id}`, by, { entityId: id, entityName: data.name });
  },
};

// ---- Batches ----
export const batchRepo = {
  create: async (data: Omit<Batch, 'id' | keyof Meta>, by: string) => {
    const id = await create<Batch>(COL.batches, data, by);
    await logActivity('create', 'batch', `Created Batch ${data.number}`, by, { entityId: id });
    return id;
  },
  patch: async (id: string, data: Partial<Batch>, by: string) => {
    await patch(COL.batches, id, data, by);
    await logActivity('update', 'batch', `Updated batch ${id}`, by, { entityId: id });
  },
  remove: async (id: string, by: string = 'staff') => {
    await deleteDoc(doc(db, COL.batches, id));
    await logActivity('delete', 'batch', `Deleted batch ${id}`, by, { entityId: id });
  },
  setPlanningCell: async (id: string, key: string, field: 'onsiteExtra' | 'ordered' | 'received', value: number, by: string) => {
    await updateDoc(doc(db, COL.batches, id), new FieldPath('planning', key, field), value, new FieldPath('updatedAt'), Date.now(), new FieldPath('updatedBy'), by);
    await logActivity('update', 'batch', `Updated batch planning (${key}.${field} = ${value})`, by, { entityId: id });
  },
};

// ---- Sequential order IDs ----

/**
 * Inside a transaction: take the next sequence number of the batch and return the
 * `<eventcode>_<batch>_<seq>` id. Reads must happen before any write in the same transaction,
 * so call this before writing anything else.
 */
export async function allocateTransactionId(tx: Transaction, batch: Batch, event: Event): Promise<string> {
  const ref = doc(db, COL.counters, batch.id);
  const snap = await tx.get(ref);
  const next = snap.exists() ? Number((snap.data() as Omit<Counter, 'id'>).next) || 1 : 1;
  tx.set(ref, { next: next + 1 });
  return transactionId(event, batch, next);
}

// ---- Orders ----
export const orderRepo = {
  create: async (data: Omit<Order, 'id' | keyof Meta>, by: string) => {
    const id = await create<Order>(COL.orders, data, by);
    await logActivity('create', 'order', `Created order ${id} for ${data.customer.name}`, by, { entityId: id });
    return id;
  },
  /** Create an order with the next sequential transaction id of its batch. */
  createNumbered: async (data: Omit<Order, 'id' | keyof Meta | 'transactionId'>, batch: Batch, event: Event, by: string): Promise<{ id: string; transactionId: string }> => {
    const id = newId();
    const tid = await runTransaction(db, async (tx) => {
      const t = await allocateTransactionId(tx, batch, event);
      tx.set(doc(db, COL.orders, id), clean({ ...data, transactionId: t, ...stamp(by) }));
      return t;
    });
    await logActivity('create', 'order', `Created manual order ${tid} for ${data.customer.name}`, by, { entityId: id, entityName: tid });
    return { id, transactionId: tid };
  },
  patch: async (id: string, data: Partial<Order>, by: string) => {
    await patch(COL.orders, id, data, by);
    await logActivity('update', 'order', `Updated order ${id}`, by, { entityId: id });
  },
  setStatus: async (o: Order, status: OrderStatus, by: string, extra: Partial<Order> = {}) => {
    const now = Date.now();
    const data: Partial<Order> = { status, ...extra };
    if (status === 'collected') data.collectedAt = now;
    if (status === 'shipped') data.shippedAt = now;
    if (status === 'cancelled') data.cancelledAt = now;
    const b = writeBatch(db);
    b.update(doc(db, COL.orders, o.id), clean({ ...data, ...touch(by) }));
    if (status === 'shipped') {
      for (const l of o.lines) {
        b.set(doc(db, COL.movements, newId()), clean({
          itemId: l.itemId, variantId: l.variantId, qty: -l.qty, reason: 'shipped',
          eventId: o.eventId, orderId: o.id, note: `Shipped to ${o.customer.name}`, createdAt: now, createdBy: by,
        }));
      }
    }
    await b.commit();
    await logActivity('status_change', 'order', `Changed order ${o.transactionId || o.id} status to ${status}`, by, { entityId: o.id, entityName: o.transactionId });
  },
  bulkSetStatus: async (orders: Order[], status: OrderStatus, by: string) => {
    for (let i = 0; i < orders.length; i += 200) {
      const b = writeBatch(db);
      const now = Date.now();
      for (const o of orders.slice(i, i + 200)) {
        const data: Record<string, unknown> = { status, ...touch(by) };
        if (status === 'collected') data.collectedAt = now;
        b.update(doc(db, COL.orders, o.id), data);
      }
      await b.commit();
    }
    await logActivity('status_change', 'order', `Bulk updated ${orders.length} orders status to ${status}`, by);
  },
  listForEvent: async (eventId: string): Promise<Order[]> => {
    const snap = await getDocs(query(collection(db, COL.orders), where('eventId', '==', eventId)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }));
  },
};

// ---- Stock movements ----
export const movementRepo = {
  create: async (data: Omit<StockMovement, 'id' | 'createdAt' | 'createdBy'>, by: string) => {
    const id = newId();
    await setDoc(doc(db, COL.movements, id), clean({ ...data, createdAt: Date.now(), createdBy: by }));
    await logActivity('create', 'movement', `Created stock movement: ${data.qty > 0 ? `+${data.qty}` : data.qty} (${data.reason})`, by, { entityId: id });
  },
  bulkCreate: async (rows: Omit<StockMovement, 'id' | 'createdAt' | 'createdBy'>[], by: string): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < rows.length; i += 400) {
      const b = writeBatch(db);
      for (const r of rows.slice(i, i + 400)) {
        const id = newId();
        ids.push(id);
        b.set(doc(db, COL.movements, id), clean({ ...r, createdAt: Date.now(), createdBy: by }));
      }
      await b.commit();
    }
    await logActivity('bulk_create', 'movement', `Logged ${rows.length} stock movements`, by);
    return ids;
  },
};

// ---- Wrap-ups ----
export const wrapupRepo = {
  ensure: async (eventId: string, by: string) => {
    const ref = doc(db, COL.wrapups, eventId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const w: Omit<Wrapup, 'id'> = { status: 'draft', rows: {}, bundlesSold: {}, movementIds: [], ...stamp(by) };
      await setDoc(ref, w);
      await logActivity('create', 'wrapup', `Initiated wrap-up for event ${eventId}`, by, { entityId: eventId });
    }
  },
  setCell: async (eventId: string, key: string, field: 'brought' | 'leftover', value: number | null, by: string) => {
    await updateDoc(doc(db, COL.wrapups, eventId), new FieldPath('rows', key, field), value, new FieldPath('rows', key, 'editedBy'), by, new FieldPath('updatedAt'), Date.now(), new FieldPath('updatedBy'), by);
    await logActivity('update', 'wrapup', `Updated wrap-up cell (${key}.${field} = ${value})`, by, { entityId: eventId });
  },
  setBundleSold: async (eventId: string, bundleId: string, value: number, by: string) => {
    await updateDoc(doc(db, COL.wrapups, eventId), new FieldPath('bundlesSold', bundleId), value, new FieldPath('updatedAt'), Date.now(), new FieldPath('updatedBy'), by);
    await logActivity('update', 'wrapup', `Updated wrap-up bundle sold count (${bundleId} = ${value})`, by, { entityId: eventId });
  },
  patch: async (eventId: string, data: Partial<Wrapup>, by: string) => {
    await patch(COL.wrapups, eventId, data, by);
    await logActivity('update', 'wrapup', `Updated wrap-up status / details for event ${eventId}`, by, { entityId: eventId });
  },
};

// ---- Media ----
export const mediaRepo = {
  create: async (data: Omit<Media, 'id' | 'createdAt' | 'createdBy'>, by: string): Promise<string> => {
    const id = newId();
    await setDoc(doc(db, COL.media, id), { ...data, createdAt: Date.now(), createdBy: by });
    return id;
  },
  remove: (id: string) => deleteDoc(doc(db, COL.media, id)),
};

// ---- Forms ----
export const formRepo = {
  /** The form id is the batch id, which is what ties a form to exactly one batch. */
  create: async (batchId: string, data: Omit<FormDoc, 'id' | keyof Meta>, by: string) => {
    await setDoc(doc(db, COL.forms, batchId), clean({ ...data, ...stamp(by) }));
    await logActivity('create', 'form', `Created preorder form for batch ${batchId}`, by, { entityId: batchId });
    return batchId;
  },
  patch: async (id: string, data: Partial<FormDoc>, by: string) => {
    await patch(COL.forms, id, data, by);
    await logActivity('update', 'form', `Updated form configuration ${id}`, by, { entityId: id });
  },
  remove: async (id: string, by: string = 'staff') => {
    const b = writeBatch(db);
    b.delete(doc(db, COL.forms, id));
    b.delete(doc(db, COL.publicForms, id));
    await b.commit();
    await logActivity('delete', 'form', `Removed form and public snapshot ${id}`, by, { entityId: id });
  },
  /** Write the public snapshot and stamp the form as published. */
  publish: async (formId: string, pf: Omit<PublicForm, 'id'>, hash: string, by: string) => {
    const b = writeBatch(db);
    b.set(doc(db, COL.publicForms, formId), clean(pf));
    b.update(doc(db, COL.forms, formId), { publishedAt: pf.publishedAt, publishedHash: hash, enabled: pf.enabled, ...touch(by) });
    await b.commit();
    await logActivity('publish', 'form', `Published public form snapshot v${pf.version}`, by, { entityId: formId, entityName: pf.title });
  },
  /** Flip accepting on the form and, when it has been published, on the public snapshot too. */
  setEnabled: async (formId: string, enabled: boolean, published: boolean, by: string) => {
    const b = writeBatch(db);
    b.update(doc(db, COL.forms, formId), { enabled, ...touch(by) });
    if (published) b.update(doc(db, COL.publicForms, formId), { enabled });
    await b.commit();
    await logActivity('update', 'form', `${enabled ? 'Enabled (opened)' : 'Disabled (paused)'} preorder form`, by, { entityId: formId });
  },
};

// ---- Submissions (staff side) ----
export const submissionRepo = {
  patch: async (id: string, data: Partial<Submission>, by: string = 'staff') => {
    await updateDoc(doc(db, COL.submissions, id), clean(data));
    await logActivity('update', 'submission', `Updated submission ${id} (status: ${data.status || 'modified'})`, by, { entityId: id });
  },
  remove: async (id: string, by: string = 'staff') => {
    await deleteDoc(doc(db, COL.submissions, id));
    await logActivity('delete', 'submission', `Removed submission ${id}`, by, { entityId: id });
  },
};

// ---- Settings ----
export const settingsRepo = {
  save: async (data: Settings, by: string) => {
    await setDoc(doc(db, COL.settings, 'global'), { ...data, ...touch(by) }, { merge: true });
    await logActivity('update', 'settings', `Updated global circle settings (Currency: ${data.currency}, Deadline: ${data.pickupDeadlineDays}d)`, by);
  },
};
