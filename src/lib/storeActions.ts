'use client';

// Storefront writes: publish the catalogue and lanes, the mail-order switch and its override,
// and the standing mail-order channel. An object so the localhost sandbox can swap the methods.
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { COL, clean, eventRepo, logActivity } from './repo';
import { fetchManyMedia } from './media';
import { storefrontOf } from './pricing';
import { unweighedLabels } from './shipping';
import { buildStorefront, endOfToday, laneIdFor, MAIL_LANE_ID, mediaIdsForProducts, overrideActive, STORE_EVENT_CODE, storeHashFor } from './store';
import type { Batch, Event, FormDoc, Item, Settings, Staff, StoreCatalog, StoreStatus } from '@/types';

export const STORE_CATALOG_ID = 'catalog';
export const STORE_STATUS_ID = 'status';
const catalogRef = () => doc(db, COL.publicStore, STORE_CATALOG_ID);
const statusRef = () => doc(db, COL.publicStore, STORE_STATUS_ID);

/** Firestore documents are capped at 1 MiB; keep a margin. */
const CATALOG_LIMIT = 950_000;

export interface PublishInput {
  items: Item[];
  events: Event[];
  batches: Batch[];
  formsById: Map<string, FormDoc>;
  settings: Settings;
  current: StoreCatalog | null;
  status: StoreStatus | null;
  /** Orders the catalogue by manager name. */
  staff?: Staff[];
  by: string;
}

export const storeRepo = {
  /** The standing mail-order channel: one event of kind `store`, created on first use. */
  ensureStoreEvent: async (events: Event[], settings: Settings, by: string): Promise<Event> => {
    const existing = events.find((e) => e.kind === 'store');
    if (existing) return existing;
    const data: Omit<Event, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'> = {
      name: 'Mail order', code: STORE_EVENT_CODE, kind: 'store', status: 'upcoming', startDate: '', endDate: '', venue: '',
      pickupDeadlineDays: settings.pickupDeadlineDays, notes: 'Standing channel for storefront mail orders. Never wrapped.',
    };
    const id = await eventRepo.create(data, by);
    return { id, ...data, createdAt: Date.now(), updatedAt: Date.now(), updatedBy: by };
  },

  publish: async (input: PublishInput): Promise<{ lanes: number; products: number; unweighed: string[] }> => {
    const storeEvent = await storeRepo.ensureStoreEvent(input.events, input.settings, input.by);
    const media = await fetchManyMedia(mediaIdsForProducts(input.items, storefrontOf(input.settings)));
    const build = buildStorefront({ ...input, media, storeEvent });
    const version = (input.current?.version ?? 0) + 1;
    const catalog: StoreCatalog = { ...build.catalog, publishedHash: storeHashFor({ ...input, storeEvent }), version, publishedAt: Date.now() };
    const size = new TextEncoder().encode(JSON.stringify(catalog)).length;
    if (size > CATALOG_LIMIT) {
      throw new Error(`The storefront catalogue would be ${Math.round(size / 1024)} KB, over the ${Math.round(CATALOG_LIMIT / 1024)} KB limit. Move inline thumbnails to Cloud Storage in Settings, then publish again.`);
    }
    const b = writeBatch(db);
    b.set(catalogRef(), clean(catalog));
    for (const l of build.lanes) b.set(doc(db, COL.publicForms, l.id), clean({ ...l.doc, version }));
    // Lanes from the previous publish that are gone now (batch closed, event wrapped) stop accepting.
    const now = new Set(build.lanes.map((l) => l.id));
    for (const old of input.current?.lanes ?? []) if (!now.has(old.id)) b.set(doc(db, COL.publicForms, old.id), { enabled: false }, { merge: true });
    if (!input.status) b.set(statusRef(), { mailOrderOpen: false, updatedAt: Date.now() });
    await b.commit();
    await logActivity('publish', 'form', `Published the storefront (${catalog.products.length} products, ${build.lanes.length - 1} preorder lanes)`, input.by);
    const unweighed = [...new Set(build.lanes.filter((l) => l.doc.enabled || l.id !== MAIL_LANE_ID).flatMap((l) => unweighedLabels(l.doc.items)))];
    return { lanes: build.lanes.length - 1, products: catalog.products.length, unweighed };
  },

  /** The staff switch. The mail lane accepts while the switch or the override is on. */
  setMailOrder: async (open: boolean, status: StoreStatus | null, laneExists: boolean, by: string) => {
    // Closing also ends an override: "closed" means closed.
    const next: StoreStatus = clean({ mailOrderOpen: open, overrideUntil: open ? status?.overrideUntil : undefined, updatedAt: Date.now() });
    const b = writeBatch(db);
    b.set(statusRef(), next);
    if (laneExists) b.update(doc(db, COL.publicForms, MAIL_LANE_ID), { enabled: open || overrideActive(next) });
    await b.commit();
    await logActivity('update', 'settings', open ? 'Opened mail order on the storefront' : 'Closed mail order on the storefront', by);
  },

  /** "Open mail order anyway" until the end of today, or end it early with `on = false`. */
  setOverride: async (on: boolean, status: StoreStatus | null, laneExists: boolean, by: string) => {
    const next: StoreStatus = { mailOrderOpen: on ? true : !!status?.mailOrderOpen, ...(on ? { overrideUntil: endOfToday() } : {}), updatedAt: Date.now() };
    const b = writeBatch(db);
    b.set(statusRef(), next);
    if (laneExists) b.update(doc(db, COL.publicForms, MAIL_LANE_ID), { enabled: next.mailOrderOpen || on });
    await b.commit();
    await logActivity('update', 'settings', on ? 'Opened mail order anyway until the end of today' : 'Ended the mail-order override', by);
  },

  /** Keep a preorder lane's accepting flag in step with its batch being opened or closed. */
  mirrorBatch: async (batchId: string, open: boolean) => {
    const ref = doc(db, COL.publicForms, laneIdFor(batchId));
    const snap = await getDoc(ref);
    if (snap.exists()) await writeBatch(db).update(ref, { enabled: open }).commit();
    return snap.exists();
  },
};
