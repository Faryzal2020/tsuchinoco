'use client';

// Live subscriptions to the small global collections. Orders are subscribed
// globally only while open (for committed stock); per-event orders come from
// useEventOrders.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where, type DocumentData, type QuerySnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { COL } from './repo';
import { useAuth } from './auth';
import type { Batch, Event, FormDoc, FormTemplate, Item, Order, PublicForm, PublicPrices, Settings, StoreCatalog, StoreStatus, Staff, StockMovement, Submission, ThemePresetDoc, Wrapup } from '@/types';
import { DEFAULT_SETTINGS, OPEN_ORDER_STATUSES } from '@/types';

interface Data {
  loaded: boolean;
  staff: Staff[];
  items: Item[];
  itemsById: Map<string, Item>;
  events: Event[];
  batches: Batch[];
  openOrders: Order[];
  movements: StockMovement[];
  wrapups: Wrapup[];
  forms: FormDoc[];
  formsById: Map<string, FormDoc>;
  publicForms: PublicForm[];
  publicFormsById: Map<string, PublicForm>;
  /** Submissions that are not yet orders: status new or rejected. */
  submissions: Submission[];
  templates: FormTemplate[];
  templatesById: Map<string, FormTemplate>;
  /** Shared theme presets saved from the form editor, newest first. */
  themePresets: ThemePresetDoc[];
  settings: Settings;
  /** The live price list customers see; null until the first price sync. */
  publicPrices: PublicPrices | null;
  /** The published storefront and the mail-order switch; null until first published. */
  storeCatalog: StoreCatalog | null;
  storeStatus: StoreStatus | null;
  staffName: (id: string) => string;
}

const Ctx = createContext<Data | null>(null);
/** Sandbox only: every order, so the per-event order hooks read sample data instead of Firestore. */
const OrdersOverride = createContext<Order[] | null>(null);

/** Fixed data, for the localhost sandbox only. */
export function StaticDataProvider({ value, allOrders, children }: { value: Data; allOrders: Order[]; children: React.ReactNode }) {
  return <Ctx.Provider value={value}><OrdersOverride.Provider value={allOrders}>{children}</OrdersOverride.Provider></Ctx.Provider>;
}

export type { Data };

function rowsOf<T>(snap: QuerySnapshot<DocumentData>): T[] {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const ready = state.phase === 'ready';
  const [staff, setStaff] = useState<Staff[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [wrapups, setWrapups] = useState<Wrapup[]>([]);
  const [forms, setForms] = useState<FormDoc[]>([]);
  const [publicForms, setPublicForms] = useState<PublicForm[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [themePresets, setThemePresets] = useState<ThemePresetDoc[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [publicPrices, setPublicPrices] = useState<PublicPrices | null>(null);
  const [storeCatalog, setStoreCatalog] = useState<StoreCatalog | null>(null);
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    if (!ready) return;
    const bump = () => setLoadedCount((n) => n + 1);
    const log = (name: string) => (e: Error) => console.error(`[data] ${name}`, e);
    const unsubs = [
      onSnapshot(collection(db, COL.staff), (s) => { setStaff(rowsOf<Staff>(s)); bump(); }, log('staff')),
      onSnapshot(collection(db, COL.items), (s) => { setItems(rowsOf<Item>(s)); bump(); }, log('items')),
      onSnapshot(collection(db, COL.events), (s) => { setEvents(rowsOf<Event>(s)); bump(); }, log('events')),
      onSnapshot(collection(db, COL.batches), (s) => { setBatches(rowsOf<Batch>(s)); bump(); }, log('batches')),
      onSnapshot(query(collection(db, COL.orders), where('status', 'in', OPEN_ORDER_STATUSES)), (s) => { setOpenOrders(rowsOf<Order>(s)); bump(); }, log('openOrders')),
      onSnapshot(collection(db, COL.movements), (s) => { setMovements(rowsOf<StockMovement>(s)); bump(); }, log('movements')),
      onSnapshot(collection(db, COL.wrapups), (s) => { setWrapups(rowsOf<Wrapup>(s)); bump(); }, log('wrapups')),
      onSnapshot(collection(db, COL.forms), (s) => { setForms(rowsOf<FormDoc>(s)); bump(); }, log('forms')),
      onSnapshot(collection(db, COL.publicForms), (s) => { setPublicForms(rowsOf<PublicForm>(s)); bump(); }, log('publicForms')),
      onSnapshot(query(collection(db, COL.submissions), where('status', 'in', ['new', 'rejected'])), (s) => { setSubmissions(rowsOf<Submission>(s)); bump(); }, log('submissions')),
      onSnapshot(collection(db, COL.templates), (s) => { setTemplates(rowsOf<FormTemplate>(s)); bump(); }, log('templates')),
      onSnapshot(collection(db, COL.themePresets), (s) => { setThemePresets(rowsOf<ThemePresetDoc>(s)); bump(); }, log('themePresets')),
      onSnapshot(doc(db, COL.publicPrices, 'current'), (s) => { setPublicPrices(s.exists() ? (s.data() as PublicPrices) : null); bump(); }, log('publicPrices')),
      onSnapshot(doc(db, COL.publicStore, 'catalog'), (s) => { setStoreCatalog(s.exists() ? (s.data() as StoreCatalog) : null); bump(); }, log('storeCatalog')),
      onSnapshot(doc(db, COL.publicStore, 'status'), (s) => { setStoreStatus(s.exists() ? (s.data() as StoreStatus) : null); bump(); }, log('storeStatus')),
      onSnapshot(doc(db, COL.settings, 'global'), (s) => { setSettings(s.exists() ? { ...DEFAULT_SETTINGS, ...(s.data() as Partial<Settings>) } : DEFAULT_SETTINGS); bump(); }, log('settings')),
    ];
    return () => { unsubs.forEach((u) => u()); setLoadedCount(0); };
  }, [ready]);

  const value = useMemo<Data>(() => {
    const itemsById = new Map(items.map((i) => [i.id, i]));
    const staffById = new Map(staff.map((s) => [s.id, s]));
    return {
      loaded: loadedCount >= 16,
      staff: [...staff].sort((a, b) => a.displayName.localeCompare(b.displayName)),
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
      itemsById,
      events: [...events].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
      batches: [...batches].sort((a, b) => a.number - b.number),
      openOrders,
      movements: [...movements].sort((a, b) => b.createdAt - a.createdAt),
      wrapups,
      forms,
      formsById: new Map(forms.map((f) => [f.id, f])),
      publicForms,
      publicFormsById: new Map(publicForms.map((f) => [f.id, f])),
      submissions: [...submissions].sort((a, b) => a.submittedAt - b.submittedAt),
      templates: [...templates].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.name.localeCompare(b.name)),
      templatesById: new Map(templates.map((t) => [t.id, t])),
      themePresets: [...themePresets].sort((a, b) => a.createdAt - b.createdAt),
      settings,
      publicPrices,
      storeCatalog,
      storeStatus,
      staffName: (id: string) => staffById.get(id)?.displayName || id,
    };
  }, [staff, items, events, batches, openOrders, movements, wrapups, forms, publicForms, submissions, templates, themePresets, settings, publicPrices, storeCatalog, storeStatus, loadedCount]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const c = useContext(Ctx);
  if (!c) throw new Error('useData outside DataProvider');
  return c;
}

/** Live orders for one event (all statuses). */
export function useEventOrders(eventId: string | undefined): { orders: Order[]; loaded: boolean } {
  const override = useContext(OrdersOverride);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (override) return;
    if (!eventId) { setOrders([]); setLoaded(true); return; }
    setLoaded(false);
    return onSnapshot(
      query(collection(db, COL.orders), where('eventId', '==', eventId)),
      (s) => { setOrders(rowsOf<Order>(s).sort((a, b) => b.submittedAt - a.submittedAt)); setLoaded(true); },
      (e) => { console.error('[data] eventOrders', e); setLoaded(true); },
    );
  }, [eventId, override]);
  if (override) return { orders: override.filter((o) => o.eventId === eventId).sort((a, b) => b.submittedAt - a.submittedAt), loaded: true };
  return { orders, loaded };
}

/** Live orders for several events (all statuses). Firestore allows up to 30 ids in one `in` query. */
export function useOrdersForEvents(eventIds: string[]): { orders: Order[]; loaded: boolean } {
  const key = eventIds.slice(0, 30).sort().join(',');
  const override = useContext(OrdersOverride);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (override) return;
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setOrders([]); setLoaded(true); return; }
    setLoaded(false);
    return onSnapshot(
      query(collection(db, COL.orders), where('eventId', 'in', ids)),
      (s) => { setOrders(rowsOf<Order>(s).sort((a, b) => b.submittedAt - a.submittedAt)); setLoaded(true); },
      (e) => { console.error('[data] ordersForEvents', e); setLoaded(true); },
    );
  }, [key, override]);
  if (override) { const ids = new Set(key ? key.split(',') : []); return { orders: override.filter((o) => ids.has(o.eventId)).sort((a, b) => b.submittedAt - a.submittedAt), loaded: true }; }
  return { orders, loaded };
}
