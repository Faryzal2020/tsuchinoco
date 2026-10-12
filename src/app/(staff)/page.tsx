'use client';

// Orders across upcoming events, plus the queue of customer submissions being turned into orders.
import React, { useMemo, useState } from 'react';
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
import type { Order, OrderStatus } from '@/types';
import Button from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Empty, Loading, PageHeader, Panel, Pill, StatusPill, TableWrap } from '@/components/ui/Bits';
import OrderModal from '@/components/event/OrderModal';
import ManualOrderModal from '@/components/event/ManualOrderModal';

const STATUSES: OrderStatus[] = ['awaiting_pickup', 'collected', 'not_collected', 'awaiting_shipment', 'shipped', 'cancelled'];

function OrdersPage() {
  const { events, batches, settings, items, staff, movements } = useData();
  const { currentEventId } = usePrefs();
  const { get, set } = useQuery();
  const eventFilter = get('event');
  const batchId = get('batch');
  const status = get('status');
  const fulfilment = get('fulfilment');
  const [search, setSearch] = useState('');
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [manual, setManual] = useState(false);

  const upcoming = useMemo(() => events.filter((e) => e.status === 'upcoming').sort((a, b) => (a.startDate || '9').localeCompare(b.startDate || '9')), [events]);
  const scopeIds = useMemo(() => (eventFilter ? [eventFilter] : upcoming.map((e) => e.id)), [eventFilter, upcoming]);
  const { orders, loaded } = useOrdersForEvents(scopeIds);
  const live = useMemo(() => orders.find((o) => o.id === openOrder?.id) ?? null, [orders, openOrder]);

  const eventById = new Map(events.map((e) => [e.id, e]));
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const scopeBatches = batches.filter((b) => scopeIds.includes(b.eventId));

  const rows = orders.filter((o) => {
    if (batchId && o.batchId !== batchId) return false;
    if (status && o.status !== status) return false;
    if (fulfilment && o.fulfilment !== fulfilment) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!o.customer.name.toLowerCase().includes(s) && !o.customer.email.toLowerCase().includes(s) && !(o.transactionId ?? '').toLowerCase().includes(s) && !o.customer.phone.includes(s)) return false;
    }
    return true;
  });

  const manualEvent = eventById.get(eventFilter || currentEventId) ?? upcoming[0];
  const openTotal = rows.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);
  const firstRun = items.length === 0 || events.length === 0;

  const exportCsv = () => downloadCsv('orders', toCsv(rows.map((o) => ({
    id: o.transactionId ?? '', submitted: formatDateTime(o.submittedAt), event: eventById.get(o.eventId)?.name ?? '', batch: batchById.get(o.batchId)?.number ?? '',
    name: o.customer.name, email: o.customer.email, phone: o.customer.phone, fulfilment: o.fulfilment, pickupDay: o.pickupDay ?? '', status: o.status,
    items: orderItemCount(o), total: o.total, address: o.customer.address ?? '', notes: o.notes,
  }))));

  return (
    <>
      <PageHeader title="Orders" actions={<><Button onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button><Button variant="primary" onClick={() => setManual(true)} disabled={!manualEvent}>Add manual order</Button></>}>
        {eventFilter ? eventById.get(eventFilter)?.name : upcoming.length === 0 ? 'No upcoming events.' : `All upcoming events: ${upcoming.map((e) => e.name).join(', ')}.`}
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

      <div className="mb-3 flex flex-wrap items-center gap-2">
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
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Input small placeholder="Search name, e-mail, phone, or ID" value={search} onChange={(e) => setSearch(e.target.value)} className="w-[260px]" />
        <span className="hint ml-auto">{rows.length} orders · {formatMoney(openTotal, settings.currency)}</span>
      </div>

      {!loaded ? <Loading label="Loading orders…" /> : rows.length === 0 ? (
        <Empty title="No orders">{orders.length === 0 ? 'Orders appear here as customers submit the preorder form.' : 'Nothing matches these filters.'}</Empty>
      ) : (
        <TableWrap>
          <thead><tr><th>ID</th><th>Submitted</th><th>Event</th><th>Customer</th><th>Fulfilment</th><th>Status</th><th className="num">Items</th><th className="num">Total</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => setOpenOrder(o)}>
                <td className="mono whitespace-nowrap">{o.transactionId || <span className="text-muted">—</span>}</td>
                <td className="whitespace-nowrap">{formatDateTime(o.submittedAt)}</td>
                <td className="whitespace-nowrap">{eventById.get(o.eventId)?.name ?? '?'} <span className="text-ink-2">B{batchById.get(o.batchId)?.number ?? '?'}</span></td>
                <td><span className="font-semibold">{o.customer.name}</span><span className="hint block">{o.customer.email || o.customer.phone}</span></td>
                <td>{o.fulfilment === 'pickup' ? 'Pickup' : 'Mail'}{o.pickupDay && <span className="hint block">{o.pickupDay}</span>}</td>
                <td><StatusPill status={o.status} />{o.status === 'not_collected' && isPastIso(o.returnToStockBy) && <Pill tone="red" className="ml-1">Overdue</Pill>}</td>
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
            const eo = orders.filter((o) => o.eventId === e.id && o.status !== 'cancelled');
            return (
              <Panel key={e.id}>
                <div className="flex items-baseline justify-between gap-2"><Link href={`/events/view/?id=${e.id}`} className="font-bold text-blue-ink">{e.name}</Link><span className="hint">{formatDate(e.startDate)}</span></div>
                <div className="hint mt-1">{eo.filter((o) => o.fulfilment === 'pickup').length} pickup · {eo.filter((o) => o.fulfilment === 'mail').length} mail</div>
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
        <span className="hint">{busy ? 'Importing…' : 'Imported automatically while the app is open.'}</span>
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
