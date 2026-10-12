'use client';

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { orderRepo } from '@/lib/repo';
import { useQuery } from '@/lib/useQuery';
import { linesByKey, orderItemCount } from '@/lib/compute';
import { formatDate, formatDateTime, formatMoney, isPastIso } from '@/lib/format';
import { splitKey } from '@/lib/keys';
import { downloadCsv, toCsv } from '@/lib/csv';
import type { Order, OrderStatus } from '@/types';
import Button from '@/components/ui/Button';
import { Checkbox, Input, Select } from '@/components/ui/Field';
import { Empty, Pill, StatusPill, TableWrap } from '@/components/ui/Bits';
import { useVariantLabel } from '@/components/VariantSelect';
import OrderModal from './OrderModal';
import ManualOrderModal from './ManualOrderModal';
import type { TabProps } from './types';

const VIEWS = [
  { id: 'list', label: 'All orders' },
  { id: 'items', label: 'Item summary' },
  { id: 'pickup', label: 'Pickup list' },
  { id: 'packing', label: 'Packing list' },
];

export default function OrdersTab({ event, batches, orders }: TabProps) {
  const { get, set } = useQuery();
  const view = get('view', 'list');
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [manual, setManual] = useState(false);
  const live = useMemo(() => orders.find((o) => o.id === openOrder?.id) ?? null, [orders, openOrder]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line-strong bg-white p-0.5">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => set({ view: v.id })}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === v.id ? 'bg-yellow-soft text-yellow-ink' : 'text-ink-2 hover:text-ink'}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setManual(true)}>Add manual order</Button>
        </div>
      </div>

      {view === 'list' && <OrderList event={event} batches={batches} orders={orders} onOpen={setOpenOrder} />}
      {view === 'items' && <ItemSummary batches={batches} orders={orders} />}
      {view === 'pickup' && <PickupList event={event} orders={orders} onOpen={setOpenOrder} />}
      {view === 'packing' && <PackingList event={event} orders={orders} onOpen={setOpenOrder} />}

      <OrderModal order={live} event={event} onClose={() => setOpenOrder(null)} />
      <ManualOrderModal open={manual} onClose={() => setManual(false)} event={event} batches={batches} />
    </div>
  );
}

function OrderList({ event, batches, orders, onOpen }: TabProps & { onOpen: (o: Order) => void }) {
  const { settings } = useData();
  const { get, set } = useQuery();
  const [search, setSearch] = useState('');
  const batchId = get('batch');
  const fulfilment = get('fulfilment');
  const status = get('status');

  const rows = orders.filter((o) => {
    if (batchId && o.batchId !== batchId) return false;
    if (fulfilment && o.fulfilment !== fulfilment) return false;
    if (status && o.status !== status) return false;
    if (search) { const s = search.toLowerCase(); if (!o.customer.name.toLowerCase().includes(s) && !o.customer.email.toLowerCase().includes(s)) return false; }
    return true;
  });
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.number ?? '?';

  const exportCsv = () => downloadCsv(`${event.name}-orders`, toCsv(rows.map((o) => ({
    submitted: formatDateTime(o.submittedAt), batch: batchNo(o.batchId), name: o.customer.name, email: o.customer.email, phone: o.customer.phone,
    fulfilment: o.fulfilment, status: o.status, items: orderItemCount(o), total: o.total, address: o.customer.address ?? '', externalId: o.externalId, notes: o.notes,
  }))));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input small placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="w-[220px]" />
        <Select small value={batchId} onChange={(e) => set({ batch: e.target.value })} className="w-[130px]"><option value="">All batches</option>{batches.map((b) => <option key={b.id} value={b.id}>Batch {b.number}</option>)}</Select>
        <Select small value={fulfilment} onChange={(e) => set({ fulfilment: e.target.value })} className="w-[130px]"><option value="">Pickup + mail</option><option value="pickup">Pickup</option><option value="mail">Mail</option></Select>
        <Select small value={status} onChange={(e) => set({ status: e.target.value })} className="w-[170px]">
          <option value="">All statuses</option>
          {(['awaiting_pickup', 'collected', 'not_collected', 'awaiting_shipment', 'shipped', 'cancelled'] as OrderStatus[]).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <span className="hint">{rows.length} of {orders.length}</span>
        <Button size="sm" className="ml-auto" onClick={exportCsv}>Export CSV</Button>
      </div>
      {rows.length === 0 ? <Empty title="No orders">{orders.length === 0 ? 'Orders appear here as the form receives submissions.' : 'Nothing matches these filters.'}</Empty> : (
        <TableWrap>
          <thead><tr><th>Submitted</th><th>Batch</th><th>Customer</th><th>Fulfilment</th><th>Status</th><th className="num">Items</th><th className="num">Total</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => onOpen(o)}>
                <td className="whitespace-nowrap">{formatDateTime(o.submittedAt)}</td>
                <td>B{batchNo(o.batchId)}</td>
                <td><span className="font-semibold">{o.customer.name}</span><span className="hint block">{o.customer.email}</span></td>
                <td>{o.fulfilment === 'pickup' ? 'Pickup' : 'Mail'}</td>
                <td><StatusPill status={o.status} />{o.status === 'not_collected' && isPastIso(o.returnToStockBy) && <Pill tone="red" className="ml-1">Overdue</Pill>}</td>
                <td className="num">{orderItemCount(o)}</td>
                <td className="num">{formatMoney(o.total, settings.currency)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}

function ItemSummary({ batches, orders }: Pick<TabProps, 'batches' | 'orders'>) {
  const { itemsById, staffName } = useData();
  const { get, set } = useQuery();
  const labelOf = useVariantLabel();
  const batchId = get('batch');

  const rows = useMemo(() => {
    const pickup = new Map<string, number>(); const mail = new Map<string, number>();
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      if (batchId && o.batchId !== batchId) continue;
      const target = o.fulfilment === 'pickup' ? pickup : mail;
      for (const [k, q] of linesByKey(o.lines)) target.set(k, (target.get(k) ?? 0) + q);
    }
    const keys = new Set([...pickup.keys(), ...mail.keys()]);
    return [...keys].map((key) => { const { itemId, variantId } = splitKey(key); const l = labelOf(itemId, variantId); return { key, itemId, item: l.item, variant: l.variant, manager: staffName(itemsById.get(itemId)?.managerId ?? ''), pickup: pickup.get(key) ?? 0, mail: mail.get(key) ?? 0 }; })
      .sort((a, b) => a.item.localeCompare(b.item) || a.variant.localeCompare(b.variant));
  }, [orders, batchId, labelOf, itemsById, staffName]);

  const tot = rows.reduce((t, r) => ({ pickup: t.pickup + r.pickup, mail: t.mail + r.mail }), { pickup: 0, mail: 0 });
  let last = '';
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Select small value={batchId} onChange={(e) => set({ batch: e.target.value })} className="w-[130px]"><option value="">All batches</option>{batches.map((b) => <option key={b.id} value={b.id}>Batch {b.number}</option>)}</Select>
        <span className="hint">Bundles are counted as their component items. Cancelled orders excluded.</span>
        <Button size="sm" className="ml-auto" onClick={() => downloadCsv('item-summary', toCsv(rows.map(({ item, variant, manager, pickup, mail }) => ({ item, variant, manager, pickup, mail, total: pickup + mail }))))}>Export CSV</Button>
      </div>
      {rows.length === 0 ? <Empty title="No order lines yet" /> : (
        <TableWrap>
          <thead><tr><th>Item</th><th>Variant</th><th>Manager</th><th className="num">Pickup</th><th className="num">Mail</th><th className="num">Total</th></tr></thead>
          <tbody>
            {rows.map((r) => { const first = last !== r.item; last = r.item; return (
              <tr key={r.key}><td className="font-semibold">{first ? r.item : ''}</td><td>{r.variant || '—'}</td><td className="text-ink-2">{first ? r.manager : ''}</td><td className="num">{r.pickup}</td><td className="num">{r.mail}</td><td className="num font-semibold">{r.pickup + r.mail}</td></tr>
            ); })}
            <tr className="group"><td colSpan={3}>Total units</td><td className="num">{tot.pickup}</td><td className="num">{tot.mail}</td><td className="num">{tot.pickup + tot.mail}</td></tr>
          </tbody>
        </TableWrap>
      )}
    </>
  );
}

function PickupList({ event, orders, onOpen }: { event: TabProps['event']; orders: Order[]; onOpen: (o: Order) => void }) {
  const { me } = useAuth();
  const { run } = useToast();
  const labelOf = useVariantLabel();
  const [search, setSearch] = useState('');
  const [bulk, setBulk] = useState(false);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const rows = orders.filter((o) => o.fulfilment === 'pickup' && (o.status === 'awaiting_pickup' || o.status === 'collected') && (!search || o.customer.name.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => a.customer.name.localeCompare(b.customer.name));
  const waiting = rows.filter((o) => o.status === 'awaiting_pickup');

  const bulkCollect = async () => {
    setBusy(true);
    const targets = waiting.filter((o) => !keep.has(o.id));
    const ok = await run(() => orderRepo.bulkSetStatus(targets, 'collected', me), `${targets.length} marked collected`);
    setBusy(false);
    if (ok) { setBulk(false); setKeep(new Set()); }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 no-print">
        <Input placeholder="Customer name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-[240px]" autoFocus />
        <span className="hint">{waiting.length} waiting · {rows.length - waiting.length} collected</span>
        <div className="ml-auto flex gap-2">
          {!bulk ? <Button size="sm" onClick={() => setBulk(true)} disabled={waiting.length === 0}>Reconcile: mark all collected except…</Button> : (
            <>
              <Button size="sm" onClick={() => { setBulk(false); setKeep(new Set()); }}>Cancel</Button>
              <Button size="sm" variant="primary" busy={busy} onClick={bulkCollect}>Mark {waiting.length - keep.size} collected</Button>
            </>
          )}
          <Button size="sm" onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      {bulk && <p className="mb-3 rounded-md bg-yellow-soft px-3 py-2 text-sm text-yellow-ink">Tick the orders that were <b>not</b> collected. Everyone else will be marked collected.</p>}
      {rows.length === 0 ? <Empty title="No pickup orders" /> : (
        <TableWrap>
          <thead><tr>{bulk && <th>Not collected</th>}<th>Customer</th><th>Items</th><th>Status</th><th className="no-print" /></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className={o.status === 'collected' ? 'opacity-60' : ''}>
                {bulk && <td>{o.status === 'awaiting_pickup' && <Checkbox checked={keep.has(o.id)} onChange={(e) => setKeep((s) => { const n = new Set(s); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} />}</td>}
                <td><span className="font-semibold text-base">{o.customer.name}</span><span className="hint block">{o.customer.phone || o.customer.email}</span></td>
                <td className="text-sm">{o.rawLines.map((l, i) => { const lb = labelOf(l.itemId, l.variantId ?? 'default'); return <span key={i} className="block">{l.qty} × {lb.item}{lb.variant && ` · ${lb.variant}`}</span>; })}</td>
                <td><StatusPill status={o.status} /></td>
                <td className="no-print text-right whitespace-nowrap">
                  {o.status === 'awaiting_pickup' && !bulk && <Button size="sm" variant="primary" onClick={() => run(() => orderRepo.setStatus(o, 'collected', me), 'Collected')}>Collected</Button>}
                  {o.status === 'collected' && !bulk && <Button size="sm" variant="quiet" onClick={() => run(() => orderRepo.setStatus(o, 'awaiting_pickup', me))}>Undo</Button>}
                  <Button size="sm" variant="quiet" onClick={() => onOpen(o)}>Details</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <p className="hint mt-2">{event.name}. Works offline; changes sync when the connection returns.</p>
    </>
  );
}

function PackingList({ event, orders, onOpen }: { event: TabProps['event']; orders: Order[]; onOpen: (o: Order) => void }) {
  const { me } = useAuth();
  const { run } = useToast();
  const labelOf = useVariantLabel();
  const [showShipped, setShowShipped] = useState(false);
  const rows = orders.filter((o) => (o.status === 'awaiting_shipment' || (showShipped && o.status === 'shipped')) || (o.status === 'not_collected' && o.customer.address))
    .sort((a, b) => a.customer.name.localeCompare(b.customer.name));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 no-print">
        <Checkbox label="Include shipped" checked={showShipped} onChange={(e) => setShowShipped(e.target.checked)} />
        <span className="hint">Mail orders plus uncollected pickups that now have an address.</span>
        <Button size="sm" className="ml-auto" onClick={() => window.print()}>Print</Button>
      </div>
      {rows.length === 0 ? <Empty title="Nothing to pack" /> : (
        <TableWrap>
          <thead><tr><th>Customer</th><th>Address</th><th>Items</th><th>Status</th><th className="no-print" /></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className={o.status === 'shipped' ? 'opacity-60' : ''}>
                <td><span className="font-semibold">{o.customer.name}</span><span className="hint block">{o.customer.phone}</span></td>
                <td className="text-sm whitespace-pre-wrap max-w-[280px]">{o.customer.address || <span className="text-red-ink">No address yet</span>}</td>
                <td className="text-sm">{o.rawLines.map((l, i) => { const lb = labelOf(l.itemId, l.variantId ?? 'default'); return <span key={i} className="block">{l.qty} × {lb.item}{lb.variant && ` · ${lb.variant}`}</span>; })}</td>
                <td><StatusPill status={o.status} />{o.shippedAt && <span className="hint block">{formatDate(o.shippedAt)}</span>}</td>
                <td className="no-print text-right whitespace-nowrap">
                  {o.status !== 'shipped' && <Button size="sm" variant="primary" disabled={!o.customer.address} onClick={() => run(() => orderRepo.setStatus(o, 'shipped', me), 'Marked shipped, stock updated')}>Shipped</Button>}
                  <Button size="sm" variant="quiet" onClick={() => onOpen(o)}>Details</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <p className="hint mt-2">{event.name}. Marking shipped posts the stock movement.</p>
    </>
  );
}
