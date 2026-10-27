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
import { deleteObject, ref } from 'firebase/storage';
import { db, storage } from './firebase';
import { newId } from './keys';
import { transactionId } from './forms';
import type {
  Batch, Counter, Event, FormDoc, FormTemplate, Item, Media, Order, OrderStatus, PublicForm, Settings, Staff, StockMovement, Submission, Wrapup,
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
    return id;
  },
  patch: (id: string, data: Partial<Staff>, by: string) => patch(COL.staff, id, data, by),
};

// ---- Items ----
export const itemRepo = {
  create: (data: Omit<Item, 'id' | keyof Meta>, by: string, id?: string) => create<Item>(COL.items, data, by, id),
  patch: (id: string, data: Partial<Item>, by: string) => patch(COL.items, id, data, by),
  remove: (id: string) => deleteDoc(doc(db, COL.items, id)),
  bulkCreate: async (rows: Omit<Item, 'id' | keyof Meta>[], by: string) => {
    const chunks: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += 400) chunks.push(rows.slice(i, i + 400));
    for (const chunk of chunks) {
      const b = writeBatch(db);
      for (const r of chunk) b.set(doc(db, COL.items, newId()), clean({ ...r, ...stamp(by) }));
      await b.commit();
    }
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
  },
};

// ---- Events ----
export const eventRepo = {
  create: (data: Omit<Event, 'id' | keyof Meta>, by: string) => create<Event>(COL.events, data, by),
  patch: (id: string, data: Partial<Event>, by: string) => patch(COL.events, id, data, by),
};

// ---- Batches ----
export const batchRepo = {
  create: (data: Omit<Batch, 'id' | keyof Meta>, by: string) => create<Batch>(COL.batches, data, by),
  patch: (id: string, data: Partial<Batch>, by: string) => patch(COL.batches, id, data, by),
  remove: (id: string) => deleteDoc(doc(db, COL.batches, id)),
  setPlanningCell: (id: string, key: string, field: 'onsiteExtra' | 'ordered' | 'received', value: number, by: string) =>
    // Variant keys contain ':' so they must go through FieldPath, not a dotted string.
    updateDoc(doc(db, COL.batches, id), new FieldPath('planning', key, field), value, new FieldPath('updatedAt'), Date.now(), new FieldPath('updatedBy'), by),
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
  create: (data: Omit<Order, 'id' | keyof Meta>, by: string) => create<Order>(COL.orders, data, by),
  /** Create an order with the next sequential transaction id of its batch. */
  createNumbered: async (data: Omit<Order, 'id' | keyof Meta | 'transactionId'>, batch: Batch, event: Event, by: string): Promise<{ id: string; transactionId: string }> => {
    const id = newId();
    const tid = await runTransaction(db, async (tx) => {
      const t = await allocateTransactionId(tx, batch, event);
      tx.set(doc(db, COL.orders, id), clean({ ...data, transactionId: t, ...stamp(by) }));
      return t;
    });
    return { id, transactionId: tid };
  },
  patch: (id: string, data: Partial<Order>, by: string) => patch(COL.orders, id, data, by),
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
  },
  listForEvent: async (eventId: string): Promise<Order[]> => {
    const snap = await getDocs(query(collection(db, COL.orders), where('eventId', '==', eventId)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }));
  },
};

// ---- Stock movements ----
export const movementRepo = {
  create: (data: Omit<StockMovement, 'id' | 'createdAt' | 'createdBy'>, by: string) =>
    setDoc(doc(db, COL.movements, newId()), clean({ ...data, createdAt: Date.now(), createdBy: by })),
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
    }
  },
  setCell: (eventId: string, key: string, field: 'brought' | 'leftover', value: number | null, by: string) =>
    updateDoc(doc(db, COL.wrapups, eventId), new FieldPath('rows', key, field), value, new FieldPath('rows', key, 'editedBy'), by, new FieldPath('updatedAt'), Date.now(), new FieldPath('updatedBy'), by),
  setBundleSold: (eventId: string, bundleId: string, value: number, by: string) =>
    updateDoc(doc(db, COL.wrapups, eventId), new FieldPath('bundlesSold', bundleId), value, new FieldPath('updatedAt'), Date.now(), new FieldPath('updatedBy'), by),
  patch: (eventId: string, data: Partial<Wrapup>, by: string) => patch(COL.wrapups, eventId, data, by),
};

// ---- Media ----
export const mediaRepo = {
  create: async (data: Omit<Media, 'id' | 'createdAt' | 'createdBy'>, by: string): Promise<string> => {
    const id = newId();
    await setDoc(doc(db, COL.media, id), clean({ ...data, createdAt: Date.now(), createdBy: by }));
    return id;
  },
  createWithId: async (media: Media): Promise<string> => {
    await setDoc(doc(db, COL.media, media.id), clean(media));
    return media.id;
  },
  remove: async (id: string, storagePath?: string) => {
    if (storagePath) {
      deleteObject(ref(storage, storagePath)).catch(() => undefined);
    }
    return deleteDoc(doc(db, COL.media, id));
  },
};

// ---- Forms ----
export const formRepo = {
  /** The form id is the batch id, which is what ties a form to exactly one batch. */
  create: async (batchId: string, data: Omit<FormDoc, 'id' | keyof Meta>, by: string) => {
    await setDoc(doc(db, COL.forms, batchId), clean({ ...data, ...stamp(by) }));
    return batchId;
  },
  patch: (id: string, data: Partial<FormDoc>, by: string) => patch(COL.forms, id, data, by),
  remove: async (id: string) => {
    const b = writeBatch(db);
    b.delete(doc(db, COL.forms, id));
    b.delete(doc(db, COL.publicForms, id));
    await b.commit();
  },
  /** Write the public snapshot and stamp the form as published. */
  publish: async (formId: string, pf: Omit<PublicForm, 'id'>, hash: string, by: string) => {
    const b = writeBatch(db);
    b.set(doc(db, COL.publicForms, formId), clean(pf));
    b.update(doc(db, COL.forms, formId), { publishedAt: pf.publishedAt, publishedHash: hash, enabled: pf.enabled, ...touch(by) });
    await b.commit();
  },
  /** Flip accepting on the form and, when it has been published, on the public snapshot too. */
  setEnabled: async (formId: string, enabled: boolean, published: boolean, by: string) => {
    const b = writeBatch(db);
    b.update(doc(db, COL.forms, formId), { enabled, ...touch(by) });
    if (published) b.update(doc(db, COL.publicForms, formId), { enabled });
    await b.commit();
  },
};

// ---- Submissions (staff side) ----
export const submissionRepo = {
  patch: (id: string, data: Partial<Submission>) => updateDoc(doc(db, COL.submissions, id), clean(data)),
  remove: (id: string) => deleteDoc(doc(db, COL.submissions, id)),
};

// ---- Settings ----
export const settingsRepo = {
  save: (data: Settings, by: string) => setDoc(doc(db, COL.settings, 'global'), { ...data, ...touch(by) }, { merge: true }),
};

// ---- Form Templates ----
export const templateRepo = {
  create: async (data: Omit<FormTemplate, 'id' | keyof Meta>, by: string): Promise<string> => {
    const id = newId();
    await setDoc(doc(db, COL.templates, id), clean({ ...data, ...stamp(by) }));
    return id;
  },
  patch: (id: string, data: Partial<FormTemplate>, by: string) => patch(COL.templates, id, data, by),
  remove: (id: string) => deleteDoc(doc(db, COL.templates, id)),
  setDefault: async (id: string, by: string) => {
    const b = writeBatch(db);
    const snap = await getDocs(collection(db, COL.templates));
    snap.forEach((d) => {
      b.update(d.ref, { isDefault: d.id === id, ...touch(by) });
    });
    await b.commit();
  },
};
