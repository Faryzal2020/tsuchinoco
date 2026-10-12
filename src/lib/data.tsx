'use client';

// Live subscriptions to the small global collections. Orders are subscribed
// globally only while open (for committed stock); per-event orders come from
// useEventOrders.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where, type DocumentData, type QuerySnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { COL } from './repo';
import { useAuth } from './auth';
import type { Batch, Event, Item, Order, Settings, Staff, StockMovement, Wrapup } from '@/types';
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
  settings: Settings;
  staffName: (id: string) => string;
}

const Ctx = createContext<Data | null>(null);

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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
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
      onSnapshot(doc(db, COL.settings, 'global'), (s) => { setSettings(s.exists() ? { ...DEFAULT_SETTINGS, ...(s.data() as Partial<Settings>) } : DEFAULT_SETTINGS); bump(); }, log('settings')),
    ];
    return () => { unsubs.forEach((u) => u()); setLoadedCount(0); };
  }, [ready]);

  const value = useMemo<Data>(() => {
    const itemsById = new Map(items.map((i) => [i.id, i]));
    const staffById = new Map(staff.map((s) => [s.id, s]));
    return {
      loaded: loadedCount >= 8,
      staff: [...staff].sort((a, b) => a.displayName.localeCompare(b.displayName)),
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
      itemsById,
      events: [...events].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
      batches: [...batches].sort((a, b) => a.number - b.number),
      openOrders,
      movements: [...movements].sort((a, b) => b.createdAt - a.createdAt),
      wrapups,
      settings,
      staffName: (id: string) => staffById.get(id)?.displayName || id,
    };
  }, [staff, items, events, batches, openOrders, movements, wrapups, settings, loadedCount]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const c = useContext(Ctx);
  if (!c) throw new Error('useData outside DataProvider');
  return c;
}

/** Live orders for one event (all statuses). */
export function useEventOrders(eventId: string | undefined): { orders: Order[]; loaded: boolean } {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!eventId) { setOrders([]); setLoaded(true); return; }
    setLoaded(false);
    return onSnapshot(
      query(collection(db, COL.orders), where('eventId', '==', eventId)),
      (s) => { setOrders(rowsOf<Order>(s).sort((a, b) => b.submittedAt - a.submittedAt)); setLoaded(true); },
      (e) => { console.error('[data] eventOrders', e); setLoaded(true); },
    );
  }, [eventId]);
  return { orders, loaded };
}
