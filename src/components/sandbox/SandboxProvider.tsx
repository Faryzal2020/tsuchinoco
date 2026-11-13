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
import { batchRepo, itemRepo, orderRepo, settingsRepo } from '@/lib/repo';
import { storeRepo } from '@/lib/storeActions';
import { buildStorefront, MAIL_LANE_BATCH, MAIL_LANE_ID, monthBatchFor, overrideActive, endOfToday, storeHashFor } from '@/lib/store';
import { rawLinesFromSubmission } from '@/lib/importCore';
import { expandLines } from '@/lib/bundle';
import { transactionId } from '@/lib/forms';
import { orderTypeForBatch } from '@/lib/pricing';
import { paymentOf } from '@/lib/orders';
import { fx } from '@/lib/functions';
import { primeMedia } from '@/lib/media';
import { feesFor, parcelForForm, QUOTE_TTL_MS, resolveShipping, shippingTotal, unweighedFlag, unweighedLabels, validPostalCode } from '@/lib/shipping';
import { emailRef, emailsDue, notificationsOf } from '@/lib/orderEmail';
import type { Batch, Event, Order, OrderStatus, PublicForm, Settings, ShippingOption, ShippingQuote, ShippingQuoteResult, StoreCatalog, StoreStatus } from '@/types';
import type { ShopDraft } from '@/components/shop/Shop';
import { makeSandbox, SANDBOX_ME, type SandboxState } from './fixtures';

interface Full extends SandboxState {
  catalog: StoreCatalog | null;
  lanes: Record<string, PublicForm>;
}

function publishInto(s: Full): Full {
  const storeEvent = s.events.find((e) => e.kind === 'store') as Event;
  const input = { items: s.items, events: s.events, batches: s.batches, formsById: new Map(), settings: s.settings, storeEvent, status: s.storeStatus, staff: s.staff };
  const b = buildStorefront({ ...input, media: new Map(s.media.map((m) => [m.id, m])) });
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

const initial = (): Full => {
  const s = makeSandbox();
  // The staff preview resolves images through the media cache, so the sample images go in first.
  for (const m of s.media) primeMedia(m);
  return publishInto({ ...s, catalog: null, lanes: {} });
};

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
    const saved = { order: { ...orderRepo }, batch: { ...batchRepo }, item: { ...itemRepo }, settings: { ...settingsRepo }, store: { ...storeRepo }, fx: { ...fx } };
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
    fx.quoteShipping = async (req) => sandboxQuote(ref.current.lanes[req.formId], ref.current.settings, req);
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
    itemRepo.patch = async (id, data) => { set((x) => ({ ...x, items: x.items.map((i) => (i.id === id ? { ...i, ...data, updatedAt: Date.now() } : i)) })); };
    batchRepo.patch = async (id, data) => { set((x) => ({ ...x, batches: x.batches.map((b) => (b.id === id ? { ...b, ...data } : b)) })); };
    settingsRepo.save = async (data) => { set((x) => ({ ...x, settings: { ...x.settings, ...data } })); };
    storeRepo.publish = async () => { set((x) => publishInto(x)); const c = ref.current.catalog; return { lanes: (c?.lanes.length ?? 1) - 1, products: c?.products.length ?? 0, unweighed: [...new Set(Object.values(ref.current.lanes).flatMap((l) => unweighedLabels(l.items)))] }; };
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
    return () => { Object.assign(orderRepo, saved.order); Object.assign(batchRepo, saved.batch); Object.assign(itemRepo, saved.item); Object.assign(settingsRepo, saved.settings); Object.assign(storeRepo, saved.store); Object.assign(fx, saved.fx); };
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
    // Shipping as the server import would charge it, against the quotes this sandbox handed out.
    const r = resolveShipping({ sub: draft, submittedAt: Date.now(), pf: x.lanes[draft.formId] ?? null, quote: draft.shipping ? sandboxQuotes.get(draft.shipping.quoteId) ?? null : null });
    const ship = r.kind === 'ok' ? r.shipping : undefined;
    const shipFlag = r.kind === 'ok' ? unweighedFlag(r.unweighed) : r.kind === 'flag' ? r.flag : r.kind === 'requote' ? `Shipping was priced again at import because ${r.reason}.` : '';
    const order: Order = {
      id: `sbx${Date.now()}`, eventId: event.id, batchId: batch.id, source: 'store', externalId: '', transactionId: transactionId(event, batch, seq),
      pickupDay: fulfilment === 'pickup' ? draft.pickupDay : undefined, submittedAt: Date.now(), customer: draft.customer, fulfilment,
      status: fulfilment === 'pickup' ? 'awaiting_pickup' : 'awaiting_shipment', orderType, payment: 'unpaid', paymentMethod: draft.paymentMethod,
      priceFlag: changed.length ? `Price changed during checkout: ${changed.join(', ')}. Confirm the total with the customer.` : undefined,
      rawLines, lines: expandLines(rawLines, itemsById), total: rawLines.reduce((t, l) => t + l.lineTotal, 0) + (fulfilment === 'mail' ? shippingTotal(ship) : 0),
      notes: draft.notes ? `Customer note: ${draft.notes}` : '', createdAt: Date.now(), updatedAt: Date.now(), updatedBy: 'customer',
      ...(fulfilment === 'mail' ? { shipping: ship, shippingFlag: shipFlag || undefined, customerUid: draft.customerUid } : {}),
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
      storeCatalog: s.catalog, storeStatus: s.storeStatus, staffName: (id: string) => s.staff.find((x) => x.id === id)?.displayName || id,
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

/**
 * Made-up Lion prices for the sandbox: per kg by the postcode's first digit (1 is Jakarta, the
 * cheapest); 99999 has no delivery. Same checks and fees as the real quoteShipping.
 */
export async function sandboxQuote(pf: Pick<PublicForm, 'items' | 'maxQtyPerLine' | 'settings'> | undefined, settings: Pick<Settings, 'storefront'>, req: { postalCode: string; lines: Record<string, number>; formId?: string; uid?: string }): Promise<ShippingQuoteResult> {
  await new Promise((r) => setTimeout(r, 400));
  if (!validPostalCode(req.postalCode)) throw new Error('Enter a five-digit postcode.');
  if (!pf) throw new Error('This form is not taking orders.');
  const parcel = parcelForForm(pf, req.lines);
  if ('error' in parcel) throw new Error(parcel.error);
  const perKg = 9000 + (Number(req.postalCode[0]) - 1) * 3000;
  const options: ShippingOption[] = req.postalCode === '99999' ? [] : [
    { courier: 'lion', service: 'reg_pack', name: 'Lion REGPACK', price: perKg * parcel.billedKg, etd: '2 - 3 days' },
    { courier: 'lion', service: 'boss_pack', name: 'Lion BOSSPACK', price: Math.ceil((perKg * 1.3) / 1000) * 1000 * parcel.billedKg, etd: '1 - 2 days' },
  ];
  const now = Date.now();
  const quoteId = `sbxq${now}`;
  const quote: ShippingQuote = {
    uid: req.uid ?? 'sbx-customer', formId: req.formId ?? '', postalCode: req.postalCode, originPostalCode: '16920', lines: parcel.lines, grams: parcel.grams, billedKg: parcel.billedKg,
    unweighed: parcel.unweighed, options, ...feesFor(pf.settings, settings), createdAt: now, expiresAt: now + QUOTE_TTL_MS,
  };
  sandboxQuotes.set(quoteId, quote);
  return { quoteId, postalCode: quote.postalCode, grams: quote.grams, billedKg: quote.billedKg, unweighed: quote.unweighed, options, handlingFee: quote.handlingFee, packagingFee: quote.packagingFee, expiresAt: quote.expiresAt };
}

/** Quotes handed out by sandboxQuote, so a sandbox order is charged like a real import. */
const sandboxQuotes = new Map<string, ShippingQuote>();
