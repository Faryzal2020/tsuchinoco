'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { eventRepo } from '@/lib/repo';
import { formatDate, formatMoney } from '@/lib/format';
import Button from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Kv, Panel, Stat, StatusPill, TableWrap } from '@/components/ui/Bits';
import { Modal } from '@/components/ui/Dialog';
import type { TabProps } from './types';

export default function OverviewTab({ event, batches, orders }: TabProps) {
  const { me } = useAuth();
  const { settings, wrapups } = useData();
  const { run } = useToast();
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState({ name: event.name, startDate: event.startDate, endDate: event.endDate, venue: event.venue, notes: event.notes, pickupDeadlineDays: String(event.pickupDeadlineDays) });
  const [busy, setBusy] = useState(false);

  const live = orders.filter((o) => o.status !== 'cancelled');
  const pickup = live.filter((o) => o.fulfilment === 'pickup');
  const mail = live.filter((o) => o.fulfilment === 'mail');
  const revenue = live.reduce((s, o) => s + o.total, 0);
  const wrapup = wrapups.find((w) => w.id === event.id);

  const save = async () => {
    setBusy(true);
    const ok = await run(() => eventRepo.patch(event.id, { ...d, name: d.name.trim(), pickupDeadlineDays: Math.max(1, Number(d.pickupDeadlineDays) || settings.pickupDeadlineDays) }, me), 'Event saved');
    setBusy(false);
    if (ok) setEdit(false);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Pickup orders" value={pickup.length} sub={formatMoney(pickup.reduce((s, o) => s + o.total, 0), settings.currency)} />
          <Stat label="Mail orders" value={mail.length} sub={formatMoney(mail.reduce((s, o) => s + o.total, 0), settings.currency)} />
          <Stat label="Preorder revenue" value={formatMoney(revenue, settings.currency)} tone="yellow" />
        </div>

        <Panel pad={false}>
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="font-bold">Batches</h2>
            <Button size="sm" href={`/events/view/?id=${event.id}&tab=batches`}>Manage batches</Button>
          </div>
          {batches.length === 0 ? <p className="px-5 pb-4 hint">No batches yet. Add batch 1 to start taking preorders.</p> : (
            <TableWrap className="rounded-none border-x-0 border-b-0">
              <thead><tr><th>Batch</th><th>Mode</th><th>Window</th><th>Status</th><th>Form</th><th className="num">Orders</th></tr></thead>
              <tbody>
                {batches.map((b) => {
                  const n = orders.filter((o) => o.batchId === b.id && o.status !== 'cancelled').length;
                  return (
                    <tr key={b.id}>
                      <td className="font-semibold">Batch {b.number}</td>
                      <td>{b.mode === 'post' ? 'Post-event mail' : 'Preorder'}</td>
                      <td className="text-ink-2 whitespace-nowrap">{b.opensAt ? formatDate(b.opensAt) : '—'} → {b.closesAt ? formatDate(b.closesAt) : '—'}</td>
                      <td><StatusPill status={b.status} /></td>
                      <td>{b.form ? <a className="text-blue-ink" href={b.form.url} target="_blank" rel="noreferrer">Open form</a> : <span className="hint">not generated</span>}</td>
                      <td className="num">{n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <Panel>
          <h2 className="font-bold mb-2">Timeline</h2>
          <ol className="grid gap-2 text-sm">
            <li className="flex gap-3"><span className="w-28 text-ink-2">Before</span><span>Open batches, import orders, plan production on the <Link className="text-blue-ink" href={`/events/view/?id=${event.id}&tab=planning`}>Planning</Link> tab.</span></li>
            <li className="flex gap-3"><span className="w-28 text-ink-2">Booth day</span><span>Use the pickup list on the <Link className="text-blue-ink" href={`/events/view/?id=${event.id}&tab=orders&view=pickup`}>Orders</Link> tab to tick off collections.</span></li>
            <li className="flex gap-3"><span className="w-28 text-ink-2">After</span><span>Enter the count on <Link className="text-blue-ink" href={`/events/view/?id=${event.id}&tab=wrapup`}>Wrap-up</Link>, finalise, then read the <Link className="text-blue-ink" href={`/events/view/?id=${event.id}&tab=report`}>Report</Link>.</span></li>
          </ol>
        </Panel>
      </div>

      <div className="grid gap-5 content-start">
        <Panel>
          <div className="flex items-center justify-between mb-2"><h2 className="font-bold">Details</h2><Button size="sm" onClick={() => setEdit(true)}>Edit</Button></div>
          <Kv k="Dates" v={`${formatDate(event.startDate)}${event.endDate !== event.startDate ? ` – ${formatDate(event.endDate)}` : ''}`} />
          <Kv k="Venue" v={event.venue || '—'} />
          <Kv k="Pickup deadline" v={`${event.pickupDeadlineDays} days after`} />
          <Kv k="Wrap-up" v={wrapup ? <StatusPill status={wrapup.status} /> : 'not started'} />
          {event.notes && <p className="mt-3 text-sm text-ink-2 whitespace-pre-wrap">{event.notes}</p>}
        </Panel>
      </div>

      <Modal open={edit} onClose={() => setEdit(false)} title="Edit event" footer={<><Button onClick={() => setEdit(false)}>Cancel</Button><Button variant="primary" onClick={save} busy={busy} disabled={!d.name.trim()}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="First day"><Input type="date" value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} /></Field>
          <Field label="Last day"><Input type="date" value={d.endDate} onChange={(e) => setD({ ...d, endDate: e.target.value })} /></Field>
          <Field label="Venue and booth" className="sm:col-span-2"><Input value={d.venue} onChange={(e) => setD({ ...d, venue: e.target.value })} /></Field>
          <Field label="Days before uncollected pickups return to stock"><Input type="number" min={1} value={d.pickupDeadlineDays} onChange={(e) => setD({ ...d, pickupDeadlineDays: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
