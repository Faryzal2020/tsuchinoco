'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { orderRepo } from '@/lib/repo';
import { formatDate, formatDateTime, formatMoney, isPastIso, todayIso } from '@/lib/format';
import type { Event, Order } from '@/types';
import Button from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Kv, Pill, StatusPill } from '@/components/ui/Bits';
import { Modal } from '@/components/ui/Dialog';
import { useVariantLabel } from '@/components/VariantSelect';

export default function OrderModal({ order: o, event, onClose }: { order: Order | null; event: Event; onClose: () => void }) {
  const { me } = useAuth();
  const { settings, batches } = useData();
  const { run } = useToast();
  const labelOf = useVariantLabel();
  const [edit, setEdit] = useState(false);
  const [c, setC] = useState({ name: '', email: '', phone: '', address: '', notes: '', contactNote: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (o) setC({ name: o.customer.name, email: o.customer.email, phone: o.customer.phone, address: o.customer.address ?? '', notes: o.notes ?? '', contactNote: o.contact?.note ?? '' });
    setEdit(false);
  }, [o]);

  if (!o) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const batch = batches.find((b) => b.id === o.batchId);

  const act = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); await run(fn, ok); setBusy(false); };
  const saveCustomer = () => act(() => orderRepo.patch(o.id, { customer: { name: c.name.trim(), email: c.email.trim(), phone: c.phone.trim(), address: c.address.trim() || undefined }, notes: c.notes }, me), 'Saved').then(() => setEdit(false));
  const markContacted = () => act(() => orderRepo.patch(o.id, { contact: { contactedAt: Date.now(), note: c.contactNote } }, me), 'Contact noted');

  const terminal = o.status === 'cancelled' || o.status === 'shipped' || o.status === 'collected';

  return (
    <Modal open={!!o} onClose={onClose} title={`Order · ${o.customer.name}`} wide
      footer={
        <>
          {!terminal && <Button variant="danger" busy={busy} onClick={() => { if (confirm('Cancel this order? Committed stock is released.')) act(() => orderRepo.setStatus(o, 'cancelled', me), 'Order cancelled'); }}>Cancel order</Button>}
          <span className="flex-1" />
          {o.status === 'awaiting_pickup' && <Button variant="primary" busy={busy} onClick={() => act(() => orderRepo.setStatus(o, 'collected', me), 'Collected')}>Mark collected</Button>}
          {o.status === 'awaiting_pickup' && <Button busy={busy} onClick={() => act(() => orderRepo.setStatus(o, 'not_collected', me, { returnToStockBy: o.returnToStockBy ?? todayIso() }), 'Marked not collected')}>Not collected</Button>}
          {(o.status === 'awaiting_shipment' || o.status === 'not_collected') && <Button variant="primary" busy={busy} disabled={!o.customer.address} title={!o.customer.address ? 'Add an address first' : undefined} onClick={() => act(() => orderRepo.setStatus(o, 'shipped', me), 'Shipped, stock updated')}>Mark shipped</Button>}
          {o.status === 'collected' && <Button busy={busy} onClick={() => act(() => orderRepo.setStatus(o, 'awaiting_pickup', me), 'Back to awaiting pickup')}>Undo collected</Button>}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <StatusPill status={o.status} />
            <Pill tone="blue">{o.fulfilment === 'pickup' ? 'Pickup' : 'Mail'}</Pill>
            <Pill>Batch {batch?.number ?? '?'}</Pill>
            <Pill>{o.source}</Pill>
          </div>
          {o.status === 'not_collected' && (
            <div className={`mb-3 rounded-md px-3 py-2 text-sm ${isPastIso(o.returnToStockBy) ? 'bg-red-soft text-red-ink' : 'bg-yellow-soft text-yellow-ink'}`}>
              Not collected at {event.name}. Returns to stock {o.returnToStockBy ? formatDate(o.returnToStockBy) : 'date not set'}{isPastIso(o.returnToStockBy) && ' (overdue)'}. Contact the buyer for shipping, add their address, then mark shipped, or cancel.
            </div>
          )}
          <Kv k="Submitted" v={formatDateTime(o.submittedAt)} />
          <Kv k="Total" v={formatMoney(o.total, settings.currency)} />
          {o.collectedAt && <Kv k="Collected" v={formatDateTime(o.collectedAt)} />}
          {o.shippedAt && <Kv k="Shipped" v={formatDateTime(o.shippedAt)} />}
          {o.cancelledAt && <Kv k="Cancelled" v={formatDateTime(o.cancelledAt)} />}
          {o.externalId && <Kv k="JotForm ID" v={<span className="mono text-xs">{o.externalId}</span>} />}

          <h3 className="font-bold mt-4 mb-1">Lines</h3>
          <table className="w-full text-sm">
            <tbody>
              {o.rawLines.map((l, i) => { const lb = labelOf(l.itemId, l.variantId ?? 'default'); return (
                <tr key={i} className="border-t border-line"><td className="py-1">{l.qty} × {lb.item}{lb.variant && ` · ${lb.variant}`}</td><td className="py-1 text-right tabular-nums">{formatMoney(l.lineTotal, settings.currency)}</td></tr>
              ); })}
            </tbody>
          </table>
          {o.lines.some((l) => l.fromBundleItemId) && (
            <>
              <h4 className="hint mt-3 mb-1">Expanded for stock</h4>
              <ul className="text-xs text-ink-2 grid gap-0.5">
                {o.lines.map((l, i) => { const lb = labelOf(l.itemId, l.variantId); return <li key={i}>{l.qty} × {lb.item}{lb.variant && ` · ${lb.variant}`} @ {formatMoney(l.unitPrice, settings.currency)}{l.fromBundleItemId && ' (bundle)'}</li>; })}
              </ul>
            </>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2"><h3 className="font-bold">Customer</h3>{!edit && <Button size="sm" onClick={() => setEdit(true)}>Edit</Button>}</div>
          {!edit ? (
            <>
              <Kv k="Name" v={o.customer.name} />
              <Kv k="Email" v={o.customer.email || '—'} />
              <Kv k="Phone" v={o.customer.phone || '—'} />
              <Kv k="Address" v={<span className="whitespace-pre-wrap">{o.customer.address || '—'}</span>} />
              {o.notes && <p className="mt-2 text-sm text-ink-2 whitespace-pre-wrap">{o.notes}</p>}
            </>
          ) : (
            <div className="grid gap-2">
              <Field label="Name"><Input small value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
              <Field label="Email"><Input small value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
              <Field label="Phone"><Input small value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
              <Field label="Shipping address"><Textarea value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} /></Field>
              <Field label="Staff notes"><Textarea value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
              <div className="flex gap-2 justify-end"><Button size="sm" onClick={() => setEdit(false)}>Cancel</Button><Button size="sm" variant="primary" busy={busy} onClick={saveCustomer}>Save</Button></div>
            </div>
          )}

          {o.status === 'not_collected' && (
            <div className="mt-4 rounded-lg border border-line p-3">
              <h4 className="font-bold text-sm">Contact log</h4>
              {o.contact?.contactedAt && <p className="hint">Contacted {formatDateTime(o.contact.contactedAt)}{o.contact.note && `: ${o.contact.note}`}</p>}
              <div className="mt-2 flex gap-2">
                <Input small placeholder="Note, e.g. asked for shipping fee via DM" value={c.contactNote} onChange={(e) => setC({ ...c, contactNote: e.target.value })} />
                <Button size="sm" busy={busy} onClick={markContacted}>Contacted today</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
