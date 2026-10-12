'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { orderRepo } from '@/lib/repo';
import { expandLines } from '@/lib/bundle';
import { splitKey, variantKey, variantsOf } from '@/lib/keys';
import { formatMoney } from '@/lib/format';
import type { Batch, Event, Fulfilment, RawLine } from '@/types';
import Button from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Dialog';

interface LineDraft { key: string; qty: string }

export default function ManualOrderModal({ open, onClose, event, batches }: { open: boolean; onClose: () => void; event: Event; batches: Batch[] }) {
  const { me } = useAuth();
  const { items, itemsById, settings } = useData();
  const { run, toast } = useToast();
  const [batchId, setBatchId] = useState(batches.find((b) => b.status === 'open')?.id ?? batches.at(-1)?.id ?? '');
  const [fulfilment, setFulfilment] = useState<Fulfilment>('pickup');
  const [c, setC] = useState({ name: '', email: '', phone: '', address: '' });
  const [lines, setLines] = useState<LineDraft[]>([{ key: '', qty: '1' }]);
  const [busy, setBusy] = useState(false);

  const options = items.filter((i) => i.active).flatMap((i) => i.kind === 'bundle'
    ? [{ key: i.id, label: `${i.name} (bundle)`, price: i.price }]
    : variantsOf(i).filter((v) => v.active).map((v) => ({ key: variantKey(i.id, v.id), label: v.name ? `${i.name} · ${v.name}` : i.name, price: i.price })));

  const rawLines: RawLine[] = lines.flatMap((l) => {
    const qty = Math.round(Number(l.qty));
    if (!l.key || !Number.isFinite(qty) || qty <= 0) return [];
    const isBundle = itemsById.get(l.key)?.kind === 'bundle';
    const { itemId, variantId } = isBundle ? { itemId: l.key, variantId: undefined } : splitKey(l.key);
    const price = itemsById.get(itemId)?.price ?? 0;
    return [{ itemId, variantId, qty, unitPrice: price, lineTotal: price * qty }];
  });
  const total = rawLines.reduce((s, l) => s + l.lineTotal, 0);
  const batch = batches.find((b) => b.id === batchId);
  const valid = !!batch && c.name.trim() && rawLines.length > 0;

  const save = async () => {
    if (!valid || !batch) return;
    setBusy(true);
    const ful: Fulfilment = batch.mode === 'post' ? 'mail' : fulfilment;
    let tid = '';
    const ok = await run(async () => {
      const r = await orderRepo.createNumbered({
        eventId: event.id, batchId, source: 'manual', externalId: '', submittedAt: Date.now(),
        customer: { name: c.name.trim(), email: c.email.trim(), phone: c.phone.trim(), address: c.address.trim() || undefined },
        fulfilment: ful, status: ful === 'pickup' ? 'awaiting_pickup' : 'awaiting_shipment',
        rawLines, lines: expandLines(rawLines, itemsById), total, notes: 'Entered manually',
      }, batch, event, me);
      tid = r.transactionId;
    });
    if (ok) toast(`Order ${tid} added`);
    setBusy(false);
    if (ok) { onClose(); setC({ name: '', email: '', phone: '', address: '' }); setLines([{ key: '', qty: '1' }]); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add manual order" wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} busy={busy} disabled={!valid}>Add order · {formatMoney(total, settings.currency)}</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Field label="Batch"><Select small value={batchId} onChange={(e) => setBatchId(e.target.value)}>{batches.map((b) => <option key={b.id} value={b.id}>Batch {b.number} ({b.status})</option>)}</Select></Field>
          {batch?.mode !== 'post' && <Field label="Fulfilment"><Select small value={fulfilment} onChange={(e) => setFulfilment(e.target.value as Fulfilment)}><option value="pickup">Pickup at event</option><option value="mail">Mail</option></Select></Field>}
          <Field label="Name"><Input small value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
          <Field label="Email"><Input small value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
          <Field label="Phone"><Input small value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
          {(fulfilment === 'mail' || batch?.mode === 'post') && <Field label="Address"><Textarea value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} /></Field>}
        </div>
        <div>
          <span className="label">Lines</span>
          <div className="grid gap-2">
            {lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-[minmax(0,1fr)_64px_auto] gap-2">
                <Select small value={l.key} onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, key: e.target.value } : x)))}>
                  <option value="">Choose…</option>
                  {options.map((o) => <option key={o.key} value={o.key}>{o.label} — {formatMoney(o.price, settings.currency)}</option>)}
                </Select>
                <Input small type="number" min={1} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
                <Button size="sm" variant="quiet" onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} disabled={lines.length === 1}>Remove</Button>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-2" onClick={() => setLines((ls) => [...ls, { key: '', qty: '1' }])}>Add line</Button>
          <p className="hint mt-3">Prices are taken from the catalogue right now and stored with the order.</p>
        </div>
      </div>
    </Modal>
  );
}
