'use client';

// Small order widgets shared by the Orders page, the event tabs and the order modal.
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { orderRepo } from '@/lib/repo';
import { storefrontOf } from '@/lib/pricing';
import { holdOf, orderTypeOf, stageOf, trackingUrlFor, typeLabelOf } from '@/lib/orders';
import { eventCode } from '@/lib/forms';
import { formatDate } from '@/lib/format';
import type { Order } from '@/types';
import Button from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Pill } from '@/components/ui/Bits';
import { Modal } from '@/components/ui/Dialog';

export function OrderStagePill({ order, className }: { order: Order; className?: string }) {
  const s = stageOf(order);
  return <Pill tone={s.tone} className={className}>{s.label}</Pill>;
}

/** "Preorder · CF24" over "Pick up Day 2 (13 Dec)", or "Mail order" over "Ships after CF24 (ends 13 Dec)". */
export function OrderTypeCell({ order }: { order: Order }) {
  const { events, batches } = useData();
  const t = typeLabelOf(order, events.find((e) => e.id === order.eventId), batches.find((b) => b.id === order.batchId), events);
  return (
    <>
      <span className={`order-type ${t.type === 'preorder' ? 'order-type-po' : 'order-type-mo'}`}>{t.title}</span>
      <span className="hint block">{t.detail}</span>
    </>
  );
}

/** Courier and tracking number, then mark delivered. Warns when a mail order is still on hold. */
export function DeliverDialog({ order, open, onClose }: { order: Order | null; open: boolean; onClose: () => void }) {
  const { me } = useAuth();
  const { settings, events, batches } = useData();
  const { run } = useToast();
  const couriers = storefrontOf(settings).couriers;
  const [courier, setCourier] = useState('');
  const [other, setOther] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setCourier(order.tracking?.courier && couriers.some((c) => c.name === order.tracking?.courier) ? order.tracking.courier : couriers[0]?.name ?? '__other');
    setOther(order.tracking?.courier && !couriers.some((c) => c.name === order.tracking?.courier) ? order.tracking.courier : '');
    setNumber(order.tracking?.number ?? '');
  }, [open, order]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return null;
  const type = orderTypeOf(order, batches.find((b) => b.id === order.batchId), events.find((e) => e.id === order.eventId));
  const held = holdOf(order, type, events);
  const courierName = courier === '__other' ? other.trim() : courier;
  const valid = !!courierName && !!number.trim() && !!order.customer.address;

  const save = async () => {
    setBusy(true);
    const url = trackingUrlFor(couriers, courierName, number);
    const ok = await run(
      () => orderRepo.setStatus(order, 'shipped', me, { tracking: { courier: courierName, number: number.trim(), ...(url ? { url } : {}) }, ...(held ? { holdReleased: true } : {}) }),
      'Delivered, stock updated',
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Mark ${order.transactionId || order.customer.name} delivered`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!valid} onClick={save}>{held ? 'Deliver anyway' : 'Mark delivered'}</Button></>}>
      <div className="grid gap-3">
        {held && (
          <p className="rounded-md bg-yellow-soft px-3 py-2 text-sm text-yellow-ink">
            This mail order is meant to ship after {held.name} ({eventCode(held)}) ends on {formatDate(held.endDate || held.startDate)}. Marking it delivered now releases the hold.
          </p>
        )}
        {!order.customer.address && <p className="rounded-md bg-red-soft px-3 py-2 text-sm text-red-ink">Add the customer&apos;s address first.</p>}
        <Field label="Courier">
          <Select value={courier} onChange={(e) => setCourier(e.target.value)}>
            {couriers.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            <option value="__other">Other</option>
          </Select>
        </Field>
        {courier === '__other' && <Field label="Courier name"><Input value={other} onChange={(e) => setOther(e.target.value)} /></Field>}
        <Field label="Tracking number"><Input value={number} onChange={(e) => setNumber(e.target.value)} className="mono" autoFocus /></Field>
      </div>
    </Modal>
  );
}
