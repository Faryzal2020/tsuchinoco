'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { planningRows } from '@/lib/compute';
import { formatDate, formatMoney, isPastIso } from '@/lib/format';
import Button from '@/components/ui/Button';
import { Empty, PageHeader, Panel, Pill, StatusPill, TableWrap } from '@/components/ui/Bits';
import { useVariantLabel } from '@/components/VariantSelect';

export default function Dashboard() {
  const { events, batches, openOrders, items, itemsById, movements, settings, staff } = useData();
  const { me, meName } = useAuth();
  const labelOf = useVariantLabel();

  const activeBatches = batches.filter((b) => b.status === 'open' || b.status === 'closed');
  const eventCards = events.filter((e) => activeBatches.some((b) => b.eventId === e.id) || e.status === 'upcoming').slice(0, 4);

  // "To order" for me: across active batches, rows where net > ordered and item is mine.
  const toOrder = useMemo(() => {
    const out: { eventName: string; batchNo: number; batchId: string; eventId: string; label: { item: string; variant: string }; need: number }[] = [];
    for (const b of activeBatches) {
      const ev = events.find((e) => e.id === b.eventId);
      if (!ev) continue;
      const eventBatches = batches.filter((x) => x.eventId === b.eventId);
      // openOrders only contains open orders, which is what commits stock; for preorder counts it is also sufficient while the batch is live.
      const rows = planningRows(b, eventBatches, openOrders.filter((o) => o.batchId === b.id), items, movements, openOrders);
      for (const r of rows) {
        if (itemsById.get(r.itemId)?.managerId !== me) continue;
        if (r.netToOrder > r.ordered) out.push({ eventName: ev.name, batchNo: b.number, batchId: b.id, eventId: ev.id, label: labelOf(r.itemId, r.variantId), need: r.netToOrder - r.ordered });
      }
    }
    return out;
  }, [activeBatches, events, batches, openOrders, items, movements, itemsById, me, labelOf]);

  const notCollected = openOrders.filter((o) => o.status === 'not_collected').sort((a, b) => (a.returnToStockBy ?? '').localeCompare(b.returnToStockBy ?? ''));
  const awaitingShip = openOrders.filter((o) => o.status === 'awaiting_shipment');

  const firstRun = items.length === 0 || events.length === 0;

  return (
    <>
      <PageHeader title={`Hello, ${meName.split(' ')[0] || 'there'}`}>What needs doing this week.</PageHeader>

      {firstRun && (
        <Panel className="mb-5 bg-yellow-soft border-yellow-2/50">
          <h2 className="font-bold mb-1">Getting started</h2>
          <ol className="list-decimal pl-5 text-sm grid gap-1">
            <li className={staff.length > 1 ? 'line-through text-muted' : ''}>Add the rest of the staff in <Link href="/settings/" className="text-blue-ink">Settings</Link>.</li>
            <li className={items.length > 0 ? 'line-through text-muted' : ''}>Import the catalogue from CSV in <Link href="/catalog/import/" className="text-blue-ink">Catalogue</Link>, then add bundles by hand.</li>
            <li className={movements.length > 0 ? 'line-through text-muted' : ''}>Enter opening counts with a <Link href="/stock/take/" className="text-blue-ink">stock take</Link>.</li>
            <li className={events.length > 0 ? 'line-through text-muted' : ''}>Create the next <Link href="/events/" className="text-blue-ink">event</Link>, add batch 1, pick the offering, generate the form.</li>
          </ol>
        </Panel>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel pad={false}>
          <h2 className="font-bold px-5 pt-4 pb-2">Events in progress</h2>
          {eventCards.length === 0 ? <p className="px-5 pb-4 hint">No upcoming events.</p> : (
            <div className="divide-y divide-line">
              {eventCards.map((e) => {
                const bs = batches.filter((b) => b.eventId === e.id);
                const open = bs.find((b) => b.status === 'open');
                const eo = openOrders.filter((o) => o.eventId === e.id && o.status !== 'cancelled');
                const pickup = eo.filter((o) => o.fulfilment === 'pickup').length;
                const mail = eo.length - pickup;
                return (
                  <div key={e.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/events/view/?id=${e.id}`} className="font-semibold text-blue-ink">{e.name}</Link>
                      <span className="hint">{formatDate(e.startDate)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                      {open ? <><Pill tone="green">Batch {open.number} open</Pill>{open.closesAt && <span>closes {formatDate(open.closesAt)}</span>}</> : bs.length ? <span>{bs.map((b) => `B${b.number} ${b.status}`).join(' · ')}</span> : <span>no batches</span>}
                      <span className="ml-auto">{pickup} pickup · {mail} mail · {formatMoney(eo.reduce((s, o) => s + o.total, 0), settings.currency)} open</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel pad={false}>
          <h2 className="font-bold px-5 pt-4 pb-2">My items to order</h2>
          {toOrder.length === 0 ? <p className="px-5 pb-4 hint">Nothing short for your items in the active batches.</p> : (
            <TableWrap className="rounded-none border-x-0 border-b-0">
              <thead><tr><th>Item</th><th>Event</th><th className="num">Need</th></tr></thead>
              <tbody>
                {toOrder.map((t, i) => (
                  <tr key={i}>
                    <td><span className="font-semibold">{t.label.item}</span>{t.label.variant && <span className="text-ink-2"> · {t.label.variant}</span>}</td>
                    <td><Link href={`/events/view/?id=${t.eventId}&tab=planning&batch=${t.batchId}`} className="text-blue-ink">{t.eventName} B{t.batchNo}</Link></td>
                    <td className="num font-bold">{t.need}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <Panel pad={false}>
          <h2 className="font-bold px-5 pt-4 pb-2">Not collected</h2>
          {notCollected.length === 0 ? <p className="px-5 pb-4 hint">No uncollected pickups waiting.</p> : (
            <TableWrap className="rounded-none border-x-0 border-b-0">
              <thead><tr><th>Customer</th><th>Event</th><th>Returns to stock</th><th /></tr></thead>
              <tbody>
                {notCollected.slice(0, 15).map((o) => (
                  <tr key={o.id}>
                    <td className="font-semibold">{o.customer.name}</td>
                    <td className="text-ink-2">{events.find((e) => e.id === o.eventId)?.name}</td>
                    <td>{formatDate(o.returnToStockBy)}{isPastIso(o.returnToStockBy) && <Pill tone="red" className="ml-2">Overdue</Pill>}</td>
                    <td className="text-right"><Button size="sm" href={`/events/view/?id=${o.eventId}&tab=orders&status=not_collected`}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <Panel>
          <h2 className="font-bold mb-2">Mail orders to ship</h2>
          {awaitingShip.length === 0 ? <p className="hint">Nothing waiting for shipment.</p> : (
            <div className="grid gap-2">
              {Object.entries(awaitingShip.reduce<Record<string, number>>((m, o) => { m[o.eventId] = (m[o.eventId] ?? 0) + 1; return m; }, {})).map(([eventId, n]) => (
                <div key={eventId} className="flex items-center justify-between text-sm">
                  <span>{events.find((e) => e.id === eventId)?.name}</span>
                  <span className="flex items-center gap-2"><b>{n}</b><Button size="sm" href={`/events/view/?id=${eventId}&tab=orders&view=packing`}>Packing list</Button></span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      {!firstRun && eventCards.length === 0 && toOrder.length === 0 && notCollected.length === 0 && awaitingShip.length === 0 && (
        <div className="mt-5"><Empty title="All quiet"><StatusPill status="fulfilled" /> Nothing is waiting on you.</Empty></div>
      )}
    </>
  );
}
