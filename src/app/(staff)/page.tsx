'use client';

// Orders across upcoming events, plus the queue of customer submissions being turned into orders.
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useData, useOrdersForEvents } from '@/lib/data';
import { usePrefs } from '@/lib/prefs';
import { useToast } from '@/components/ui/Toast';
import { useImporter } from '@/components/SubmissionImporter';
import { submissionRepo } from '@/lib/repo';
import { orderItemCount } from '@/lib/compute';
import { formatDate, formatDateTime, formatMoney, isPastIso } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import { QueryPage, useQuery } from '@/lib/useQuery';
import type { Order, OrderStatus, OrderType } from '@/types';
import { useAuth } from '@/lib/auth';
import { orderRepo } from '@/lib/repo';
import { eventCode } from '@/lib/forms';
import { groupKeyOf, holdOf, isUnfulfilled, ORDER_STATUS_LABELS, orderTypeOf, paymentOf, shipFromOf } from '@/lib/orders';
import { OrderStagePill, OrderTypeCell } from '@/components/orders/OrderBits';
import Button from '@/components/ui/Button';
import { Checkbox, Input, Select } from '@/components/ui/Field';
import { Empty, Loading, PageHeader, Panel, Pill, TableWrap } from '@/components/ui/Bits';
import OrderModal from '@/components/event/OrderModal';
import ManualOrderModal from '@/components/event/ManualOrderModal';

const STATUSES: OrderStatus[] = ['awaiting_pickup', 'collected', 'not_collected', 'awaiting_shipment', 'shipped', 'cancelled'];

/** Quick views for the questions staff ask most. */
const QUICK = [
  { id: 'receipt', label: 'Receipt to check' },
  { id: 'tosend', label: 'Paid, to send' },
  { id: 'unpaidclosed', label: 'Unpaid after close' },
  { id: 'flagged', label: 'Price or shipping to check' },
] as const;

interface Row {
  o: Order;
  type: OrderType;
  group: string;
  /** Earliest shipping day (YYYY-MM-DD) of a shipped order, when known. */
  shipFrom?: string;
  held: boolean;
  paid: boolean;
}

function OrdersPage() {
  const { events, batches, settings, items, staff, movements, openOrders } = useData();
  const { me } = useAuth();
  const { run } = useToast();
  const { currentEventId } = usePrefs();
  const { get, set } = useQuery();
  const view = get('view'); // '' = unfulfilled, 'all', or a group key
  const eventFilter = get('event');
  const batchId = get('batch');
  const status = get('status');
  const fulfilment = get('fulfilment');
  const payment = get('payment');
  const source = get('source');
  const quick = get('quick');
  // ?q= pre-fills the search (the Inbox links here with the customer's address).
  const [search, setSearch] = useState(() => get('q'));
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const upcoming = useMemo(() => events.filter((e) => e.status === 'upcoming' && e.kind !== 'store').sort((a, b) => (a.startDate || '9').localeCompare(b.startDate || '9')), [events]);
  const scopeIds = useMemo(() => (eventFilter ? [eventFilter] : upcoming.map((e) => e.id)), [eventFilter, upcoming]);
  const all = useOrdersForEvents(view === 'all' ? scopeIds : []);
  const source_ = view === 'all' ? all.orders : openOrders;
  const loaded = view === 'all' ? all.loaded : true;

  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const scopeBatches = batches.filter((b) => scopeIds.includes(b.eventId));

  const enrich = (o: Order): Row => {
    const b = batchById.get(o.batchId);
    const type = orderTypeOf(o, b, eventById.get(o.eventId));
    return { o, type, group: groupKeyOf(o, type), held: !!holdOf(o, type, events), paid: paymentOf(o) === 'paid', shipFrom: shipFromOf(o, type, eventById.get(o.eventId), events)?.date ?? undefined };
  };
  const unfulfilled = useMemo(() => openOrders.map(enrich), [openOrders, batchById, eventById, events]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tabs: one per preorder event and fulfilment, then all mail orders.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; count: number; sort: string }>();
    for (const r of unfulfilled) {
      const e = eventById.get(r.o.eventId);
      const label = r.type === 'mail_order' ? 'Mail order' : `Preorder · ${e ? eventCode(e) : '?'} ${r.o.fulfilment === 'pickup' ? 'pickup' : 'ship after event'}`;
      const sort = r.type === 'mail_order' ? 'z' : `a${e?.startDate ?? ''}${r.o.fulfilment === 'pickup' ? '0' : '1'}`;
      const g = m.get(r.group) ?? { key: r.group, label, count: 0, sort };
      g.count++;
      m.set(r.group, g);
    }
    return [...m.values()].sort((a, b) => a.sort.localeCompare(b.sort));
  }, [unfulfilled, eventById]);

  const rows = source_.map(enrich).filter((r) => {
    const o = r.o;
    if (view && view !== 'all' && r.group !== view) return false;
    if (view === 'all') {
      if (batchId && o.batchId !== batchId) return false;
      if (status && o.status !== status) return false;
      if (fulfilment && o.fulfilment !== fulfilment) return false;
    }
    if (payment && (payment === 'paid') !== r.paid) return false;
    if (source && (o.source === 'jotform' ? 'web' : o.source) !== source) return false;
    if (quick === 'receipt' && (r.paid || !o.paymentProofUrl)) return false;
    if (quick === 'tosend' && (!r.paid || r.held || !isUnfulfilled(o) || (o.fulfilment !== 'mail' && o.status !== 'not_collected'))) return false;
    if (quick === 'unpaidclosed' && (r.paid || r.type !== 'preorder' || !['closed', 'fulfilled'].includes(batchById.get(o.batchId)?.status ?? ''))) return false;
    if (quick === 'flagged' && !o.priceFlag && !o.shippingFlag) return false;
    if (search) {
      const s = search.toLowerCase();
      const hay = [o.customer.name, o.customer.email, o.customer.phone, o.transactionId ?? '', o.tracking?.number ?? ''].join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }).sort((a, b) => view === 'all'
    ? b.o.submittedAt - a.o.submittedAt
    // Unfulfilled: price and shipping flags first, then preorders before mail orders, then the
    // earliest shipping day (orders without one last), oldest first.
    : (a.o.priceFlag || a.o.shippingFlag ? 0 : 1) - (b.o.priceFlag || b.o.shippingFlag ? 0 : 1) || (a.type === b.type ? 0 : a.type === 'preorder' ? -1 : 1)
      || (a.shipFrom ?? '9').localeCompare(b.shipFrom ?? '9') || a.o.submittedAt - b.o.submittedAt);

  // An order that leaves the list (picked up, delivered, cancelled in Unfulfilled) closes its modal
  // rather than showing a stale copy; it stays reachable under All orders.
  const live = useMemo(() => source_.find((o) => o.id === openOrder?.id) ?? null, [source_, openOrder]);
  useEffect(() => { if (openOrder && loaded && !live) setOpenOrder(null); }, [openOrder, loaded, live]);
  const chosen = rows.filter((r) => selected.has(r.o.id));
  const toggle = (id: string, on: boolean) => setSelected((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n; });
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.o.id));

  const manualEvent = eventById.get(eventFilter || currentEventId) ?? upcoming[0];
  const openTotal = rows.filter((r) => r.o.status !== 'cancelled').reduce((s, r) => s + r.o.total, 0);
  const firstRun = items.length === 0 || events.length === 0;

  const exportCsv = () => downloadCsv('orders', toCsv(rows.map(({ o, type }) => ({
    id: o.transactionId ?? '', submitted: formatDateTime(o.submittedAt), type: type === 'preorder' ? 'Preorder' : 'Mail order', event: eventById.get(o.eventId)?.name ?? '', batch: batchById.get(o.batchId)?.number ?? '',
    name: o.customer.name, email: o.customer.email, phone: o.customer.phone, fulfilment: o.fulfilment, pickupDay: o.pickupDay ?? '', payment: paymentOf(o), status: ORDER_STATUS_LABELS[o.status],
    courier: o.tracking?.courier ?? '', tracking: o.tracking?.number ?? '', items: orderItemCount(o), total: o.total,
    shipping: o.shipping ? `${o.shipping.name} ${o.shipping.fee} + ${o.shipping.handlingFee + o.shipping.packagingFee} fees` : '', postcode: o.shipping?.postalCode ?? '',
    address: o.customer.address ?? '', notes: o.notes,
  }))));

  const setView = (v: string) => { setSelected(new Set()); set({ view: v || null, quick: null }); };
  const tab = (key: string, label: string, count?: number) => (
    <button type="button" key={key} onClick={() => setView(key)} className={`btn btn-sm ${view === key ? 'btn-primary' : ''}`} aria-pressed={view === key}>
      {label}{count !== undefined && <span className="ml-1.5 mono">{count}</span>}
    </button>
  );

  return (
    <>
      <PageHeader title="Orders" actions={<><Button onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button><Button variant="primary" onClick={() => setManual(true)} disabled={!manualEvent}>Add manual order</Button></>}>
        {view === 'all'
          ? (eventFilter ? eventById.get(eventFilter)?.name : upcoming.length === 0 ? 'No upcoming events.' : `All orders of upcoming events: ${upcoming.map((e) => e.name).join(', ')}.`)
          : 'Every order not yet picked up, delivered or cancelled, from every event and source.'}
      </PageHeader>

      {firstRun && (
        <Panel className="mb-5 bg-yellow-soft border-yellow-2/50">
          <h2 className="font-bold mb-1">Getting started</h2>
          <ol className="list-decimal pl-5 text-sm grid gap-1">
            <li className={staff.length > 1 ? 'line-through text-muted' : ''}>Add the rest of the staff in <Link href="/settings/" className="text-blue-ink">Settings</Link>.</li>
            <li className={items.length > 0 ? 'line-through text-muted' : ''}>Import the catalogue from CSV in <Link href="/catalog/import/" className="text-blue-ink">Catalogue</Link>, add bundles by hand, and give items a thumbnail.</li>
            <li className={movements.length > 0 ? 'line-through text-muted' : ''}>Enter opening counts with a <Link href="/stock/take/" className="text-blue-ink">stock take</Link>.</li>
            <li className={events.length > 0 ? 'line-through text-muted' : ''}>Create the next <Link href="/events/" className="text-blue-ink">event</Link>, add batch 1, pick the offering, create and publish the form.</li>
          </ol>
        </Panel>
      )}

      <SubmissionQueue />

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Order views">
        {tab('', 'Unfulfilled', unfulfilled.length)}
        {groups.map((g) => tab(g.key, g.label, g.count))}
        {tab('all', 'All orders')}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {view === 'all' && (
          <>
            <Select small value={eventFilter} onChange={(e) => set({ event: e.target.value, batch: null })} className="w-[220px]">
              <option value="">All upcoming events</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status === 'wrapped' ? ' (wrapped)' : ''}</option>)}
            </Select>
            <Select small value={batchId} onChange={(e) => set({ batch: e.target.value })} className="w-[150px]" disabled={!eventFilter}>
              <option value="">All batches</option>
              {scopeBatches.map((b) => <option key={b.id} value={b.id}>Batch {b.number}</option>)}
            </Select>
            <Select small value={fulfilment} onChange={(e) => set({ fulfilment: e.target.value })} className="w-[130px]"><option value="">Pickup + mail</option><option value="pickup">Pickup</option><option value="mail">Mail</option></Select>
            <Select small value={status} onChange={(e) => set({ status: e.target.value })} className="w-[170px]">
              <option value="">All statuses</option>
              {STATUSES.map((st) => <option key={st} value={st}>{ORDER_STATUS_LABELS[st]}</option>)}
            </Select>
          </>
        )}
        <Select small value={payment} onChange={(e) => set({ payment: e.target.value })} className="w-[140px]" aria-label="Payment">
          <option value="">Paid + unpaid</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option>
        </Select>
        <Select small value={source} onChange={(e) => set({ source: e.target.value })} className="w-[140px]" aria-label="Source">
          <option value="">All sources</option><option value="store">Storefront</option><option value="web">Form</option><option value="manual">Manual</option>
        </Select>
        <Input small placeholder="Search name, phone, order ID, tracking" value={search} onChange={(e) => setSearch(e.target.value)} className="w-[270px]" />
        <span className="hint ml-auto">{rows.length} orders · {formatMoney(openTotal, settings.currency)}</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="hint">Show only:</span>
        {QUICK.map((q) => (
          <button type="button" key={q.id} className={`btn btn-sm ${quick === q.id ? 'btn-accent' : 'btn-quiet'}`} aria-pressed={quick === q.id} onClick={() => { setSelected(new Set()); set({ quick: quick === q.id ? null : q.id }); }}>{q.label}</button>
        ))}
      </div>

      {chosen.length > 0 && (
        <Panel className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-semibold">{chosen.length} selected</span>
          <Button size="sm" variant="primary" disabled={!chosen.some((r) => !r.paid && isUnfulfilled(r.o))}
            onClick={async () => { const t = chosen.filter((r) => !r.paid && isUnfulfilled(r.o)).map((r) => r.o); if (await run(() => orderRepo.setPayment(t, 'paid', me), `${t.length} marked paid`)) setSelected(new Set()); }}>
            Mark paid
          </Button>
          <Button size="sm" disabled={!chosen.some((r) => r.held)}
            onClick={async () => { const t = chosen.filter((r) => r.held).map((r) => r.o); if (await run(() => orderRepo.releaseHold(t, me), `Hold released on ${t.length}`)) setSelected(new Set()); }}>
            Release hold
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </Panel>
      )}

      {!loaded ? <Loading label="Loading orders…" /> : rows.length === 0 ? (
        <Empty title={view === 'all' ? 'No orders' : 'Nothing to fulfil'}>{source_.length === 0 ? (view === 'all' ? 'Orders appear here as customers submit the preorder form.' : 'Every order is picked up, delivered or cancelled.') : 'Nothing matches these filters.'}</Empty>
      ) : (
        <TableWrap>
          <thead><tr>
            <th><Checkbox aria-label="Select all" checked={allOn} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.o.id)) : new Set())} /></th>
            <th>Order</th><th>Type</th><th>Customer</th><th>Stage</th><th>Source</th><th className="num">Items</th><th className="num">Total</th>
          </tr></thead>
          <tbody>
            {rows.map(({ o }) => (
              <tr key={o.id} className="clickable" onClick={() => setOpenOrder(o)}>
                <td onClick={(e) => e.stopPropagation()}><Checkbox aria-label={`Select ${o.transactionId || o.customer.name}`} checked={selected.has(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} /></td>
                <td className="whitespace-nowrap"><span className="mono">{o.transactionId || <span className="text-muted">—</span>}</span><span className="hint block">{formatDateTime(o.submittedAt)}</span></td>
                <td><OrderTypeCell order={o} /></td>
                <td><span className="font-semibold">{o.customer.name}</span><span className="hint block">{o.customer.phone || o.customer.email}</span></td>
                <td>
                  <OrderStagePill order={o} />
                  {o.status === 'not_collected' && isPastIso(o.returnToStockBy) && <Pill tone="red" className="ml-1">Overdue</Pill>}
                  {o.priceFlag && <span className="hint block text-yellow-ink">Price changed</span>}
                  {o.shippingFlag && <span className="hint block text-yellow-ink">Check shipping</span>}
                  {!o.priceFlag && paymentOf(o) === 'unpaid' && o.paymentProofUrl && isUnfulfilled(o) && <span className="hint block">Receipt uploaded</span>}
                  {o.tracking && <span className="hint block mono">{o.tracking.courier} {o.tracking.number}</span>}
                </td>
                <td>{SOURCE_LABELS[o.source] ?? o.source}</td>
                <td className="num">{orderItemCount(o)}</td>
                <td className="num">{formatMoney(o.total, settings.currency)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {upcoming.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((e) => {
            const eo = unfulfilled.filter((r) => r.o.eventId === e.id).map((r) => r.o);
            return (
              <Panel key={e.id}>
                <div className="flex items-baseline justify-between gap-2"><Link href={`/events/view/?id=${e.id}`} className="font-bold text-blue-ink">{e.name}</Link><span className="hint">{formatDate(e.startDate)}</span></div>
                <div className="hint mt-1">{eo.filter((o) => o.fulfilment === 'pickup').length} pickup · {eo.filter((o) => o.fulfilment === 'mail').length} mail still open</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" href={`/events/view/?id=${e.id}&tab=orders&view=pickup`}>Pickup list</Button>
                  <Button size="sm" href={`/events/view/?id=${e.id}&tab=orders&view=packing`}>Packing list</Button>
                  <Button size="sm" variant="quiet" href={`/events/view/?id=${e.id}&tab=planning`}>Planning</Button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {live && eventById.get(live.eventId) && <OrderModal order={live} event={eventById.get(live.eventId)!} onClose={() => setOpenOrder(null)} />}
      {manualEvent && <ManualOrderModal open={manual} onClose={() => setManual(false)} event={manualEvent} batches={batches.filter((b) => b.eventId === manualEvent.id)} />}
    </>
  );
}

const SOURCE_LABELS: Record<string, string> = { web: 'Form', jotform: 'Form (JotForm)', manual: 'Manual', store: 'Storefront' };

function SubmissionQueue() {
  const { pending, rejected, busy, errors, importNow } = useImporter();
  const { events, batches } = useData();
  const { run } = useToast();
  if (pending.length === 0 && rejected.length === 0) return null;
  const where = (eventId: string, batchId: string) => `${events.find((e) => e.id === eventId)?.name ?? '?'} B${batches.find((b) => b.id === batchId)?.number ?? '?'}`;
  return (
    <Panel className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">New submissions</h2>
        {pending.length > 0 && <Pill tone="yellow">{pending.length} waiting</Pill>}
        {rejected.length > 0 && <Pill tone="red">{rejected.length} rejected</Pill>}
        <span className="hint">{busy ? 'Importing…' : 'The server imports new submissions within seconds; this app steps in for any still waiting after 2 minutes.'}</span>
        <Button size="sm" className="ml-auto" onClick={importNow} busy={busy} disabled={pending.length === 0}>Import now</Button>
      </div>
      <div className="mt-3 grid gap-1.5 text-sm">
        {pending.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-1.5">
            <span className="font-semibold">{s.customer.name}</span>
            <span className="text-ink-2">{where(s.eventId, s.batchId)} · {Object.keys(s.lines ?? {}).length} items · {formatDateTime(s.submittedAt)}</span>
            {errors[s.id] ? <Pill tone="red">{errors[s.id]}</Pill> : <Pill tone="yellow">{busy ? 'importing' : 'waiting'}</Pill>}
          </div>
        ))}
        {rejected.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-1.5">
            <span className="font-semibold">{s.customer.name}</span>
            <span className="text-ink-2">{where(s.eventId, s.batchId)} · {formatDateTime(s.submittedAt)}</span>
            <Pill tone="red">{s.rejectReason ?? 'Rejected'}</Pill>
            <span className="hint">code {s.code}</span>
            <Button size="sm" variant="quiet" className="ml-auto" onClick={() => { if (confirm('Remove this rejected submission? The customer will have to order again.')) run(() => submissionRepo.remove(s.id), 'Removed'); }}>Remove</Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function Page() {
  return <QueryPage><OrdersPage /></QueryPage>;
}
