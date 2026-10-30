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
  Batch, Counter, Event, FieldChange, FormDoc, FormTemplate, Item, LogAction, LogEntityType, Media, Order, OrderStatus, PublicForm, Settings, Staff, StockMovement, Submission, ThemePresetDoc, Wrapup,
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
  themePresets: 'themePresets',
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;

  if (typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/** Compute field-level differences between before state and incoming patch data */
export function buildFieldChanges(
  before: unknown,
  patchData: unknown,
  prefix = ''
): FieldChange[] {
  const changes: FieldChange[] = [];
  if (!patchData || typeof patchData !== 'object') return changes;
  const pObj = patchData as Record<string, unknown>;
  const bObj = before && typeof before === 'object' ? (before as Record<string, unknown>) : null;

  const ignoreKeys = new Set(['id', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy']);

  const keysToInspect = prefix && isPlainObject(bObj)
    ? Array.from(new Set([...Object.keys(bObj), ...Object.keys(pObj)]))
    : Object.keys(pObj);

  for (const key of keysToInspect) {
    if (ignoreKeys.has(key)) continue;
    const afterVal = pObj[key];
    if (afterVal === undefined && !prefix) continue;

    const fullPath = prefix ? `${prefix}.${key}` : key;
    const beforeVal = bObj ? bObj[key] : undefined;

    if (isPlainObject(beforeVal) && isPlainObject(afterVal)) {
      const nested = buildFieldChanges(beforeVal, afterVal, fullPath);
      changes.push(...nested);
    } else {
      if (!deepEqual(beforeVal, afterVal)) {
        changes.push({
          field: fullPath,
          before: beforeVal === undefined ? null : beforeVal,
          after: afterVal === undefined ? null : afterVal,
        });
      }
    }
  }

  return changes;
}

/** Append-only immutable audit log helper */
export async function logActivity(
  action: LogAction,
  entityType: LogEntityType,
  details: string,
  by: string,
  extra?: { entityId?: string; entityName?: string; changes?: FieldChange[] }
): Promise<string> {
  const id = newId();
  try {
    await setDoc(doc(db, COL.logs, id), clean({
      action,
      entityType,
      details,
      entityId: extra?.entityId,
      entityName: extra?.entityName,
      changes: extra?.changes && extra.changes.length > 0 ? extra.changes : undefined,
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
    const before = snap.exists() ? (snap.data() as Staff) : null;
    if (snap.exists()) {
      await updateDoc(ref, { ...data, ...touch(by) });
      const changes = before ? buildFieldChanges(before, data) : [];
      const fieldNames = changes.length > 0 ? changes.map((c) => c.field).join(', ') : 'details';
      await logActivity('update', 'staff', `Updated staff member: ${fieldNames}`, by, {
        entityId: id,
        entityName: data.displayName,
        changes,
      });
    } else {
      await setDoc(ref, { email: id, ...data, ...stamp(by) });
      await logActivity('create', 'staff', `Added staff member "${data.displayName}"`, by, {
        entityId: id,
        entityName: data.displayName,
      });
    }
    return id;
  },
  patch: async (id: string, data: Partial<Staff>, by: string) => {
    const ref = doc(db, COL.staff, id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as Staff) : null;
    await patch(COL.staff, id, data, by);
    const changes = before ? buildFieldChanges(before, data as Record<string, unknown>) : [];
    const staffName = data.displayName || before?.displayName || before?.email;
    const fieldNames = changes.length > 0 ? changes.map((c) => c.field).join(', ') : 'access';
    await logActivity('update', 'staff', `Updated staff member: ${fieldNames}`, by, {
      entityId: id,
      entityName: staffName,
      changes,
    });
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
    const ref = doc(db, COL.items, id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as Item) : null;
    await patch(COL.items, id, data, by);
    const changes = before ? buildFieldChanges(before, data as Record<string, unknown>) : [];
    const itemName = data.name || before?.name;
    const fieldNames = changes.length > 0
      ? changes.map((c) => c.field).join(', ')
      : Object.keys(data).filter((k) => k !== 'updatedAt' && k !== 'updatedBy').join(', ') || 'details';
    await logActivity('update', 'item', `Updated item: ${fieldNames}`, by, {
      entityId: id,
      entityName: itemName,
      changes,
    });
  },
  remove: async (id: string, by: string = 'staff') => {
    const ref = doc(db, COL.items, id);
    const snap = await getDoc(ref);
    const itemName = snap.exists() ? (snap.data() as Item).name : undefined;
    await deleteDoc(ref);
    await logActivity('delete', 'item', itemName ? `Deleted item "${itemName}"` : 'Deleted item', by, {
      entityId: id,
      entityName: itemName,
    });
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
    const fields = Object.keys(patchData).filter((k) => k !== 'updatedAt' && k !== 'updatedBy').join(', ');
    await logActivity('bulk_update', 'item', `Bulk updated ${ids.length} items: ${fields}`, by);
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
    const ref = doc(db, COL.events, id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as Event) : null;
    await patch(COL.events, id, data, by);
    const changes = before ? buildFieldChanges(before, data as Record<string, unknown>) : [];
    const eventName = data.name || before?.name;
    const fieldNames = changes.length > 0
      ? changes.map((c) => c.field).join(', ')
      : Object.keys(data).filter((k) => k !== 'updatedAt' && k !== 'updatedBy').join(', ') || 'details';
    await logActivity('update', 'event', `Updated event: ${fieldNames}`, by, {
      entityId: id,
      entityName: eventName,
      changes,
    });
  },
};

// ---- Batches ----
export const batchRepo = {
  create: async (data: Omit<Batch, 'id' | keyof Meta>, by: string) => {
    const id = await create<Batch>(COL.batches, data, by);
    const batchName = data.number !== undefined ? `Batch ${data.number}` : 'Batch';
    await logActivity('create', 'batch', `Created ${batchName}`, by, { entityId: id, entityName: batchName });
    return id;
  },
  patch: async (id: string, data: Partial<Batch>, by: string) => {
    const ref = doc(db, COL.batches, id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as Batch) : null;
    await patch(COL.batches, id, data, by);
    const changes = before ? buildFieldChanges(before, data as Record<string, unknown>) : [];
    const batchNumber = before?.number ?? data.number;
    const batchName = batchNumber !== undefined ? `Batch ${batchNumber}` : 'Batch';
    const fieldNames = changes.length > 0
      ? changes.map((c) => c.field).join(', ')
      : Object.keys(data).filter((k) => k !== 'updatedAt' && k !== 'updatedBy').join(', ') || 'details';
    await logActivity('update', 'batch', `Updated ${batchName.toLowerCase()}: ${fieldNames}`, by, {
      entityId: id,
      entityName: batchName,
      changes,
    });
  },
  remove: async (id: string, by: string = 'staff') => {
    const ref = doc(db, COL.batches, id);
    const snap = await getDoc(ref);
    const bNum = snap.exists() ? (snap.data() as Batch).number : undefined;
    const batchName = bNum !== undefined ? `Batch ${bNum}` : 'Batch';
    await deleteDoc(ref);
    await logActivity('delete', 'batch', `Deleted ${batchName.toLowerCase()}`, by, { entityId: id, entityName: batchName });
  },
  setPlanningCell: async (id: string, key: string, field: 'onsiteExtra' | 'ordered' | 'received', value: number, by: string) => {
    const ref = doc(db, COL.batches, id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as Batch) : null;
    const beforeVal = before?.planning?.[key]?.[field] ?? 0;
    await updateDoc(ref, new FieldPath('planning', key, field), value, new FieldPath('updatedAt'), Date.now(), new FieldPath('updatedBy'), by);
    const batchNumber = before?.number;
    const batchName = batchNumber !== undefined ? `Batch ${batchNumber}` : 'Batch';
    const changes: FieldChange[] = [{
      field: `planning.${key}.${field}`,
      before: beforeVal,
      after: value,
    }];
    await logActivity('update', 'batch', `Updated batch planning: ${field}`, by, {
      entityId: id,
      entityName: batchName,
      changes,
    });
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
    const ordName = `Order for ${data.customer.name}`;
    await logActivity('create', 'order', `Created order for ${data.customer.name}`, by, { entityId: id, entityName: ordName });
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
    await logActivity('create', 'order', `Created manual order for ${data.customer.name}`, by, { entityId: id, entityName: tid });
    return { id, transactionId: tid };
  },
  patch: async (id: string, data: Partial<Order>, by: string) => {
    const ref = doc(db, COL.orders, id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as Order) : null;
    await patch(COL.orders, id, data, by);
    const changes = before ? buildFieldChanges(before, data as Record<string, unknown>) : [];
    const ordName = before?.transactionId || (before?.customer ? `Order for ${before.customer.name}` : undefined);
    const fieldNames = changes.length > 0
      ? changes.map((c) => c.field).join(', ')
      : Object.keys(data).filter((k) => k !== 'updatedAt' && k !== 'updatedBy').join(', ') || 'details';
    await logActivity('update', 'order', `Updated order: ${fieldNames}`, by, {
      entityId: id,
      entityName: ordName,
      changes,
    });
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
    const ordName = o.transactionId || (o.customer?.name ? `Order for ${o.customer.name}` : undefined);
    const changes: FieldChange[] = [{
      field: 'status',
      before: o.status,
      after: status,
    }];
    await logActivity('status_change', 'order', `Changed order status: ${o.status} → ${status}`, by, {
      entityId: o.id,
      entityName: ordName,
      changes,
    });
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
      const evSnap = await getDoc(doc(db, COL.events, eventId));
      const evName = evSnap.exists() ? (evSnap.data() as Event).name : undefined;
      const w: Omit<Wrapup, 'id'> = { status: 'draft', rows: {}, bundlesSold: {}, movementIds: [], ...stamp(by) };
      await setDoc(ref, w);
      await logActivity('create', 'wrapup', evName ? `Initiated wrap-up for event "${evName}"` : 'Initiated wrap-up', by, {
        entityId: eventId,
        entityName: evName,
      });
    }
  },
  setCell: async (eventId: string, key: string, field: 'brought' | 'leftover', value: number | null, by: string) => {
    const snap = await getDoc(doc(db, COL.wrapups, eventId));
    const before = snap.exists() ? (snap.data() as Wrapup) : null;
    const beforeVal = before?.rows?.[key]?.[field] ?? null;
    await updateDoc(doc(db, COL.wrapups, eventId), new FieldPath('rows', key, field), value, new FieldPath('rows', key, 'editedBy'), by, new FieldPath('updatedAt'), Date.now(), new FieldPath('updatedBy'), by);
    const evSnap = await getDoc(doc(db, COL.events, eventId));
    const evName = evSnap.exists() ? (evSnap.data() as Event).name : undefined;
    const changes: FieldChange[] = [{
      field: `rows.${key}.${field}`,
      before: beforeVal,
      after: value,
    }];
    await logActivity('update', 'wrapup', `Updated wrap-up: ${field}`, by, {
      entityId: eventId,
      entityName: evName,
      changes,
    });
  },
  setBundleSold: async (eventId: string, bundleId: string, value: number, by: string) => {
    const snap = await getDoc(doc(db, COL.wrapups, eventId));
    const before = snap.exists() ? (snap.data() as Wrapup) : null;
    const beforeVal = before?.bundlesSold?.[bundleId] ?? 0;
    await updateDoc(doc(db, COL.wrapups, eventId), new FieldPath('bundlesSold', bundleId), value, new FieldPath('updatedAt'), Date.now(), new FieldPath('updatedBy'), by);
    const evSnap = await getDoc(doc(db, COL.events, eventId));
    const evName = evSnap.exists() ? (evSnap.data() as Event).name : undefined;
    const changes: FieldChange[] = [{
      field: `bundlesSold.${bundleId}`,
      before: beforeVal,
      after: value,
    }];
    await logActivity('update', 'wrapup', `Updated wrap-up: bundles sold`, by, {
      entityId: eventId,
      entityName: evName,
      changes,
    });
  },
  patch: async (eventId: string, data: Partial<Wrapup>, by: string) => {
    const ref = doc(db, COL.wrapups, eventId);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as Wrapup) : null;
    await patch(COL.wrapups, eventId, data, by);
    const evSnap = await getDoc(doc(db, COL.events, eventId));
    const evName = evSnap.exists() ? (evSnap.data() as Event).name : undefined;
    const changes = before ? buildFieldChanges(before, data as Record<string, unknown>) : [];
    const fieldNames = changes.length > 0
      ? changes.map((c) => c.field).join(', ')
      : Object.keys(data).filter((k) => k !== 'updatedAt' && k !== 'updatedBy').join(', ') || 'status';
    await logActivity('update', 'wrapup', `Updated wrap-up: ${fieldNames}`, by, {
      entityId: eventId,
      entityName: evName,
      changes,
    });
  },
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
    const formTitle = data.title || 'Preorder form';
    await logActivity('create', 'form', `Created preorder form`, by, {
      entityId: batchId,
      entityName: formTitle,
    });
    return batchId;
  },
  patch: async (id: string, data: Partial<FormDoc>, by: string) => {
    const ref = doc(db, COL.forms, id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as FormDoc) : null;
    await patch(COL.forms, id, data, by);
    const changes = before ? buildFieldChanges(before, data as Record<string, unknown>) : [];
    const formTitle = data.title || before?.title;
    const fieldNames = changes.length > 0
      ? changes.map((c) => c.field).join(', ')
      : Object.keys(data).filter((k) => k !== 'updatedAt' && k !== 'updatedBy').join(', ') || 'configuration';
    await logActivity('update', 'form', `Updated form: ${fieldNames}`, by, {
      entityId: id,
      entityName: formTitle,
      changes,
    });
  },
  remove: async (id: string, by: string = 'staff') => {
    const ref = doc(db, COL.forms, id);
    const snap = await getDoc(ref);
    const formTitle = snap.exists() ? (snap.data() as FormDoc).title : undefined;
    const b = writeBatch(db);
    b.delete(ref);
    b.delete(doc(db, COL.publicForms, id));
    await b.commit();
    await logActivity('delete', 'form', formTitle ? `Removed form "${formTitle}"` : 'Removed form', by, {
      entityId: id,
      entityName: formTitle,
    });
  },
  /** Write the public snapshot and stamp the form as published. */
  publish: async (formId: string, pf: Omit<PublicForm, 'id'>, hash: string, by: string) => {
    const b = writeBatch(db);
    b.set(doc(db, COL.publicForms, formId), clean(pf));
    b.update(doc(db, COL.forms, formId), { publishedAt: pf.publishedAt, publishedHash: hash, enabled: pf.enabled, ...touch(by) });
    await b.commit();
    await logActivity('publish', 'form', `Published public form snapshot v${pf.version}`, by, {
      entityId: formId,
      entityName: pf.title,
    });
  },
  /** Flip accepting on the form and, when it has been published, on the public snapshot too. */
  setEnabled: async (formId: string, enabled: boolean, published: boolean, by: string) => {
    const ref = doc(db, COL.forms, formId);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as FormDoc) : null;
    const b = writeBatch(db);
    b.update(ref, { enabled, ...touch(by) });
    if (published) b.update(doc(db, COL.publicForms, formId), { enabled });
    await b.commit();
    const formTitle = before?.title;
    const changes: FieldChange[] = [{
      field: 'enabled',
      before: before?.enabled ?? !enabled,
      after: enabled,
    }];
    await logActivity('update', 'form', `${enabled ? 'Enabled (opened)' : 'Disabled (paused)'} preorder form`, by, {
      entityId: formId,
      entityName: formTitle,
      changes,
    });
  },
};

// ---- Submissions (staff side) ----
export const submissionRepo = {
  patch: async (id: string, data: Partial<Submission>, by: string = 'staff') => {
    const ref = doc(db, COL.submissions, id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as Submission) : null;
    await updateDoc(ref, clean(data));
    const changes = before ? buildFieldChanges(before, data as Record<string, unknown>) : [];
    const subCode = before?.code;
    const fieldNames = changes.length > 0
      ? changes.map((c) => c.field).join(', ')
      : Object.keys(data).filter((k) => k !== 'updatedAt' && k !== 'updatedBy').join(', ') || 'status';
    await logActivity('update', 'submission', `Updated submission: ${fieldNames}`, by, {
      entityId: id,
      entityName: subCode ? `Submission ${subCode}` : undefined,
      changes,
    });
  },
  remove: async (id: string, by: string = 'staff') => {
    const ref = doc(db, COL.submissions, id);
    const snap = await getDoc(ref);
    const subCode = snap.exists() ? (snap.data() as Submission).code : undefined;
    await deleteDoc(ref);
    await logActivity('delete', 'submission', subCode ? `Removed submission ${subCode}` : 'Removed submission', by, {
      entityId: id,
      entityName: subCode ? `Submission ${subCode}` : undefined,
    });
  },
};

// ---- Settings ----
export const settingsRepo = {
  save: async (data: Settings, by: string) => {
    const ref = doc(db, COL.settings, 'global');
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as Settings) : null;
    await setDoc(ref, { ...data, ...touch(by) }, { merge: true });
    const changes = before ? buildFieldChanges(before, data as unknown as Record<string, unknown>) : [];
    const fieldNames = changes.length > 0
      ? changes.map((c) => c.field).join(', ')
      : 'general';
    await logActivity('update', 'settings', `Updated global circle settings: ${fieldNames}`, by, {
      changes,
    });
  },
};

// ---- Form Templates ----
export const templateRepo = {
  create: async (data: Omit<FormTemplate, 'id' | keyof Meta>, by: string): Promise<string> => {
    const id = newId();
    await setDoc(doc(db, COL.templates, id), clean({ ...data, ...stamp(by) }));
    return id;
  },
  patch: async (id: string, data: Partial<FormTemplate>, by: string) => {
    const ref = doc(db, COL.templates, id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as FormTemplate) : null;
    await patch(COL.templates, id, data, by);
    const changes = before ? buildFieldChanges(before, data as Record<string, unknown>) : [];
    const tName = data.name || before?.name;
    const fieldNames = changes.length > 0
      ? changes.map((c) => c.field).join(', ')
      : 'template';
    await logActivity('update', 'form', `Updated form template: ${fieldNames}`, by, {
      entityId: id,
      entityName: tName,
      changes,
    });
  },
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

// ---- Theme presets (shared across staff) ----
export const themePresetRepo = {
  create: async (data: Omit<ThemePresetDoc, 'id' | keyof Meta>, by: string): Promise<string> => {
    const id = newId();
    await setDoc(doc(db, COL.themePresets, id), clean({ ...data, ...stamp(by) }));
    await logActivity('create', 'form', `Saved theme preset "${data.name}"`, by, { entityId: id, entityName: data.name });
    return id;
  },
  remove: async (id: string, by: string) => {
    const ref = doc(db, COL.themePresets, id);
    const snap = await getDoc(ref);
    const name = snap.exists() ? (snap.data() as ThemePresetDoc).name : undefined;
    await deleteDoc(ref);
    await logActivity('delete', 'form', name ? `Deleted theme preset "${name}"` : 'Deleted theme preset', by, { entityId: id, entityName: name });
  },
};
