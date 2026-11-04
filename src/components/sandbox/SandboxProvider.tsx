'use client';

// Login-free sandbox for localhost. Supplies sample data and a signed-in staff member to the real
// staff pages, and swaps the Firestore writes they use for in-memory ones, so every button works
// and nothing reaches Firebase. Mounted only by the /sandbox/ routes, which exist only in `next dev`.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { StaticAuthProvider, type AuthCtx } from '@/lib/auth';
import { StaticDataProvider, type Data } from '@/lib/data';
import { PrefsProvider } from '@/lib/prefs';
import { StaticImporterProvider } from '@/components/SubmissionImporter';
import { batchRepo, orderRepo, settingsRepo } from '@/lib/repo';
import { storeRepo } from '@/lib/storeActions';
import { buildStorefront, MAIL_LANE_BATCH, MAIL_LANE_ID, monthBatchFor, overrideActive, endOfToday, storeHashFor } from '@/lib/store';
import { rawLinesFromSubmission } from '@/lib/importCore';
import { expandLines } from '@/lib/bundle';
import { transactionId } from '@/lib/forms';
import { orderTypeForBatch } from '@/lib/pricing';
import { paymentOf } from '@/lib/orders';
import { fx } from '@/lib/functions';
import { emailRef, emailsDue, notificationsOf } from '@/lib/orderEmail';
import type { Batch, Event, Order, OrderStatus, PublicForm, StoreCatalog, StoreStatus } from '@/types';
import type { ShopDraft } from '@/components/shop/Shop';
import { makeSandbox, SANDBOX_ME, type SandboxState } from './fixtures';

interface Full extends SandboxState {
  catalog: StoreCatalog | null;
  lanes: Record<string, PublicForm>;
}

function publishInto(s: Full): Full {
  const storeEvent = s.events.find((e) => e.kind === 'store') as Event;
  const input = { items: s.items, events: s.events, batches: s.batches, formsById: new Map(), settings: s.settings, storeEvent, status: s.storeStatus };
  const b = buildStorefront({ ...input, media: new Map() });
  const version = (s.catalog?.version ?? 0) + 1;
  const lanes: Record<string, PublicForm> = {};
  for (const old of Object.values(s.lanes)) lanes[old.id] = { ...old, enabled: false };
  for (const l of b.lanes) lanes[l.id] = { id: l.id, ...l.doc, version };
  return { ...s, lanes, catalog: { ...b.catalog, publishedHash: storeHashFor(input), version, publishedAt: Date.now() } };
}

/** The "order received" e-mail the server would record for a new storefront order. */
function withEmailsOnCreate(o: Order, settings: Full['settings']): Order {
  if (!notificationsOf(settings).received.on) return o;
  return { ...o, emails: [{ type: 'received', to: o.customer.email, at: Date.now(), ok: !!o.customer.email, ref: emailRef(o, 'received'), ...(o.customer.email ? { id: 'sandbox' } : { error: 'No e-mail address on the order.' }) }] };
}

const initial = (): Full => publishInto({ ...makeSandbox(), catalog: null, lanes: {} });

interface SandboxApi {
  state: Full;
  reset: () => void;
  /** Place a storefront order the way the importer would, straight into the sample orders. */
  placeShopOrder: (draft: ShopDraft) => Order;
}
const Ctx = createContext<SandboxApi | null>(null);
export const useSandbox = () => { const c = useContext(Ctx); if (!c) throw new Error('useSandbox outside SandboxProvider'); return c; };

export default function SandboxProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<Full>(initial);
  const ref = useRef(s);
  ref.current = s;
  const set = useCallback((fn: (x: Full) => Full) => setS((x) => fn(x)), []);

  // Swap the writes the staff pages call for in-memory versions while the sandbox is mounted.
  useEffect(() => {
    const saved = { order: { ...orderRepo }, batch: { ...batchRepo }, settings: { ...settingsRepo }, store: { ...storeRepo }, fx: { ...fx } };
    // Stands in for the server's e-mail trigger: records the e-mails it would send (nothing is sent).
    const withEmails = (before: Order | null, after: Order, settings: Full['settings']): Order => {
      const on = notificationsOf(settings);
      const add = emailsDue(before, after).filter((t) => on[t].on).map((t) => ({
        type: t, to: after.customer.email, at: Date.now(), ref: emailRef(after, t),
        ...(after.skipEmail?.includes(t) ? { ok: false, skipped: true } : after.customer.email ? { ok: true, id: 'sandbox' } : { ok: false, error: 'No e-mail address on the order.' }),
      }));
      const { skipEmail: _skip, ...rest } = after;
      void _skip;
      return add.length ? { ...rest, emails: [...(after.emails ?? []), ...add] } : rest;
    };
    const patchOrders = (ids: Set<string>, fn: (o: Order) => Order) => set((x) => ({
      ...x, orders: x.orders.map((o) => (ids.has(o.id) ? withEmails(o, { ...fn(o), updatedAt: Date.now(), updatedBy: SANDBOX_ME }, x.settings) : o)),
    }));
    fx.resendOrderEmail = async ({ orderId, type }) => {
      const o = ref.current.orders.find((x) => x.id === orderId)!;
      const entry = { type, to: o.customer.email, at: Date.now(), ok: true, id: 'sandbox', by: SANDBOX_ME, ref: emailRef(o, type) };
      set((x) => ({ ...x, orders: x.orders.map((y) => (y.id === orderId ? { ...y, emails: [...(y.emails ?? []), entry] } : y)) }));
      return entry;
    };

    orderRepo.setPayment = async (orders, payment) => {
      patchOrders(new Set(orders.map((o) => o.id)), (o) => (payment === 'paid' ? { ...o, payment, paidAt: Date.now(), paidBy: SANDBOX_ME } : { ...o, payment, paidAt: undefined, paidBy: undefined }));
    };
    orderRepo.setStatus = async (o: Order, status: OrderStatus, _by: string, extra: Partial<Order> = {}) => {
      if ((status === 'collected' || status === 'shipped') && paymentOf({ ...o, ...extra }) !== 'paid') throw new Error('Mark the order paid first.');
      if (status === 'shipped' && !(extra.tracking ?? o.tracking)?.number?.trim()) throw new Error('Enter a tracking number to mark the order delivered.');
      const now = Date.now();
      patchOrders(new Set([o.id]), (x) => ({ ...x, ...extra, status, ...(status === 'collected' ? { collectedAt: now } : {}), ...(status === 'shipped' ? { shippedAt: now } : {}), ...(status === 'cancelled' ? { cancelledAt: now } : {}) }));
    };
    orderRepo.bulkSetStatus = async (orders: Order[], status: OrderStatus) => {
      if (status === 'collected' && orders.some((o) => paymentOf(o) !== 'paid')) throw new Error('Some selected orders are unpaid. Mark them paid first.');
      patchOrders(new Set(orders.map((o) => o.id)), (x) => ({ ...x, status, ...(status === 'collected' ? { collectedAt: Date.now() } : {}) }));
    };
    orderRepo.releaseHold = async (orders) => { patchOrders(new Set(orders.map((o) => o.id)), (x) => ({ ...x, holdReleased: true })); };
    orderRepo.patch = async (id, data) => { patchOrders(new Set([id]), (x) => ({ ...x, ...data })); };
    orderRepo.createNumbered = async (data, batch: Batch, event: Event) => {
      const seq = ref.current.counters[batch.id] ?? 1;
      const tid = transactionId(event, batch, seq);
      const id = `sbx${Date.now()}`;
      set((x) => ({ ...x, counters: { ...x.counters, [batch.id]: seq + 1 }, orders: [{ ...data, id, transactionId: tid, createdAt: Date.now(), updatedAt: Date.now(), updatedBy: SANDBOX_ME } as Order, ...x.orders] }));
      return { id, transactionId: tid };
    };
    batchRepo.patch = async (id, data) => { set((x) => ({ ...x, batches: x.batches.map((b) => (b.id === id ? { ...b, ...data } : b)) })); };
    settingsRepo.save = async (data) => { set((x) => ({ ...x, settings: { ...x.settings, ...data } })); };
    storeRepo.publish = async () => { set((x) => publishInto(x)); const c = ref.current.catalog; return { lanes: (c?.lanes.length ?? 1) - 1, products: c?.products.length ?? 0 }; };
    const setStatusDoc = (next: StoreStatus) => set((x) => ({
      ...x, storeStatus: next,
      lanes: x.lanes[MAIL_LANE_ID] ? { ...x.lanes, [MAIL_LANE_ID]: { ...x.lanes[MAIL_LANE_ID], enabled: next.mailOrderOpen || overrideActive(next) } } : x.lanes,
    }));
    storeRepo.setMailOrder = async (open, status) => { setStatusDoc({ mailOrderOpen: open, ...(open && status?.overrideUntil ? { overrideUntil: status.overrideUntil } : {}), updatedAt: Date.now() }); };
    storeRepo.setOverride = async (on, status) => { setStatusDoc({ mailOrderOpen: on ? true : !!status?.mailOrderOpen, ...(on ? { overrideUntil: endOfToday() } : {}), updatedAt: Date.now() }); };
    storeRepo.mirrorBatch = async (batchId, open) => {
      const id = `store_${batchId}`;
      const exists = !!ref.current.lanes[id];
      if (exists) set((x) => ({ ...x, lanes: { ...x.lanes, [id]: { ...x.lanes[id], enabled: open } } }));
      return exists;
    };
    return () => { Object.assign(orderRepo, saved.order); Object.assign(batchRepo, saved.batch); Object.assign(settingsRepo, saved.settings); Object.assign(storeRepo, saved.store); Object.assign(fx, saved.fx); };
  }, [set]);

  const placeShopOrder = useCallback((draft: ShopDraft): Order => {
    const x = ref.current;
    const itemsById = new Map(x.items.map((i) => [i.id, i]));
    const isMail = draft.batchId === MAIL_LANE_BATCH;
    const batch = isMail ? x.batches.find((b) => b.id === monthBatchFor(Date.now()).id)! : x.batches.find((b) => b.id === draft.batchId)!;
    const event = x.events.find((e) => e.id === batch.eventId)!;
    const orderType = isMail ? 'mail_order' : orderTypeForBatch(batch);
    const { lines: rawLines, changed } = rawLinesFromSubmission({ ...draft, submittedAt: Date.now() }, batch, itemsById, x.publicPrices, x.settings, orderType);
    const seq = x.counters[batch.id] ?? 1;
    const fulfilment = batch.mode === 'post' ? 'mail' : draft.fulfilment;
    const order: Order = {
      id: `sbx${Date.now()}`, eventId: event.id, batchId: batch.id, source: 'store', externalId: '', transactionId: transactionId(event, batch, seq),
      pickupDay: fulfilment === 'pickup' ? draft.pickupDay : undefined, submittedAt: Date.now(), customer: draft.customer, fulfilment,
      status: fulfilment === 'pickup' ? 'awaiting_pickup' : 'awaiting_shipment', orderType, payment: 'unpaid', paymentMethod: draft.paymentMethod,
      priceFlag: changed.length ? `Price changed during checkout: ${changed.join(', ')}. Confirm the total with the customer.` : undefined,
      rawLines, lines: expandLines(rawLines, itemsById), total: rawLines.reduce((t, l) => t + l.lineTotal, 0),
      notes: draft.notes ? `Customer note: ${draft.notes}` : '', createdAt: Date.now(), updatedAt: Date.now(), updatedBy: 'customer',
    };
    set((y) => ({ ...y, counters: { ...y.counters, [batch.id]: seq + 1 }, orders: [withEmailsOnCreate(order, y.settings), ...y.orders] }));
    return order;
  }, [set]);

  const data = useMemo<Data>(() => {
    const publicForms = Object.values(s.lanes);
    return {
      loaded: true, staff: s.staff, items: [...s.items].sort((a, b) => a.name.localeCompare(b.name)), itemsById: new Map(s.items.map((i) => [i.id, i])),
      events: s.events, batches: s.batches, openOrders: s.orders.filter((o) => ['awaiting_pickup', 'not_collected', 'awaiting_shipment'].includes(o.status)),
      movements: [], wrapups: [], forms: [], formsById: new Map(), publicForms, publicFormsById: new Map(publicForms.map((f) => [f.id, f])),
      submissions: [], templates: [], templatesById: new Map(), themePresets: [], settings: s.settings, publicPrices: s.publicPrices,
      storeCatalog: s.catalog, storeStatus: s.storeStatus, staffName: (id: string) => (id === SANDBOX_ME ? 'Sandbox staff' : id),
    };
  }, [s]);

  const auth = useMemo<AuthCtx>(() => ({
    state: { phase: 'ready', user: { email: SANDBOX_ME } as User, staff: s.staff[0] },
    signIn: async () => {}, signOut: async () => {}, me: SANDBOX_ME, meName: 'Sandbox staff',
  }), [s.staff]);

  const api = useMemo<SandboxApi>(() => ({ state: s, reset: () => setS(initial()), placeShopOrder }), [s, placeShopOrder]);

  return (
    <Ctx.Provider value={api}>
      <StaticAuthProvider value={auth}>
        <StaticDataProvider value={data} allOrders={s.orders}>
          <PrefsProvider>
            <StaticImporterProvider>{children}</StaticImporterProvider>
          </PrefsProvider>
        </StaticDataProvider>
      </StaticAuthProvider>
    </Ctx.Provider>
  );
}
