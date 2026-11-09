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
import { formatDate, formatDateTime } from '@/lib/format';
import { fx } from '@/lib/functions';
import { NOTIFICATION_LABELS, notificationsOf } from '@/lib/orderEmail';
import { paymentOf } from '@/lib/orders';
import type { NotificationType, Order } from '@/types';
import Button from '@/components/ui/Button';
import { Checkbox, Field, Input, Select } from '@/components/ui/Field';
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
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const notifyOn = notificationsOf(settings).delivered.on;

  useEffect(() => {
    if (!open || !order) return;
    setCourier(order.tracking?.courier && couriers.some((c) => c.name === order.tracking?.courier) ? order.tracking.courier : couriers[0]?.name ?? '__other');
    setOther(order.tracking?.courier && !couriers.some((c) => c.name === order.tracking?.courier) ? order.tracking.courier : '');
    setNumber(order.tracking?.number ?? '');
    setNotify(true);
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
      () => orderRepo.setStatus(order, 'shipped', me, {
        tracking: { courier: courierName, number: number.trim(), ...(url ? { url } : {}) },
        ...(held ? { holdReleased: true } : {}),
        // The e-mail is sent by the server when it sees the order delivered; this skips it once.
        ...(notifyOn && !notify ? { skipEmail: ['delivered'] } : {}),
      }),
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
        {!notifyOn ? <p className="hint">Delivery e-mails are switched off in Settings.</p>
          : !order.customer.email ? <p className="hint">No e-mail address on this order, so no tracking e-mail is sent.</p>
          : <Checkbox label={`E-mail ${order.customer.name} the tracking number`} checked={notify} onChange={(e) => setNotify(e.target.checked)} />}
      </div>
    </Modal>
  );
}

const SEND_LABELS: Record<NotificationType, string> = { received: 'Send order confirmation', paid: 'Send payment confirmation', delivered: 'Send tracking e-mail' };

/** Order-update e-mails sent for an order, newest first, with "Send again". */
export function EmailLog({ order }: { order: Order }) {
  const { run } = useToast();
  const [busy, setBusy] = useState<NotificationType | ''>('');
  const log = [...(order.emails ?? [])].sort((a, b) => b.at - a.at);
  const sendable: NotificationType[] = ['received', ...(paymentOf(order) === 'paid' ? ['paid' as const] : []), ...(order.status === 'shipped' ? ['delivered' as const] : [])];
  const send = async (type: NotificationType) => {
    setBusy(type);
    await run(async () => {
      const r = await fx.resendOrderEmail({ orderId: order.id, type });
      if (!r.ok) throw new Error(r.error || 'The e-mail was not sent.');
    }, 'E-mail queued');
    setBusy('');
  };
  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <h4 className="font-bold text-sm">E-mails to the customer</h4>
      {log.length === 0 ? <p className="hint">None sent yet.</p> : (
        <ul className="mt-1 grid gap-1 text-sm">
          {log.map((e, i) => (
            <li key={i}>
              <span className="font-semibold">{NOTIFICATION_LABELS[e.type].title}</span>
              <span className="hint"> · {formatDateTime(e.at)}{e.by ? ' · sent again by staff' : ''}</span>
              <span className="block">{e.skipped ? <span className="text-ink-2">Skipped by staff</span> : e.queued ? <span className="text-yellow-ink">Waiting in the Outbox for {e.to}</span> : e.ok ? <span className="text-ink-2">Sent to {e.to}</span> : <span className="text-red-ink">Not sent: {e.error}</span>}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {sendable.map((t) => (
          <Button key={t} size="sm" busy={busy === t} disabled={!order.customer.email} title={!order.customer.email ? 'No e-mail address on this order' : undefined} onClick={() => send(t)}>
            {SEND_LABELS[t]}
          </Button>
        ))}
      </div>
    </div>
  );
}
