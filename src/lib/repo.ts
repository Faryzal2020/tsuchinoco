// Firestore writes. Reads are live subscriptions in DataProvider.
import {
  collection,
  deleteDoc,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type WithFieldValue,
} from 'firebase/firestore';
import { db } from './firebase';
import { newId } from './keys';
import type {
  Batch, Event, Item, Order, OrderStatus, Settings, Staff, StockMovement, Wrapup,
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

// ---- Orders ----
export const orderRepo = {
  create: (data: Omit<Order, 'id' | keyof Meta>, by: string) => create<Order>(COL.orders, data, by),
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

// ---- Settings ----
export const settingsRepo = {
  save: (data: Settings, by: string) => setDoc(doc(db, COL.settings, 'global'), { ...data, ...touch(by) }, { merge: true }),
};
