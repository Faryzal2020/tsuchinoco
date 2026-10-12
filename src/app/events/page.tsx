'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { eventRepo } from '@/lib/repo';
import { formatDate, todayIso } from '@/lib/format';
import Button from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Empty, PageHeader, StatusPill, TableWrap } from '@/components/ui/Bits';
import { Modal } from '@/components/ui/Dialog';

export default function EventsPage() {
  const { events, batches, openOrders, settings } = useData();
  const { me } = useAuth();
  const { run } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState({ name: '', startDate: todayIso(), endDate: todayIso(), venue: '', notes: '' });

  const create = async () => {
    if (!d.name.trim()) return;
    setBusy(true);
    let newId = '';
    const ok = await run(async () => {
      newId = await eventRepo.create({ ...d, name: d.name.trim(), endDate: d.endDate < d.startDate ? d.startDate : d.endDate, status: 'upcoming', pickupDeadlineDays: settings.pickupDeadlineDays }, me);
    }, 'Event created');
    setBusy(false);
    if (ok) { setOpen(false); router.push(`/events/view/?id=${newId}&tab=batches`); }
  };

  return (
    <>
      <PageHeader title="Events" actions={<Button variant="primary" onClick={() => setOpen(true)}>New event</Button>} />
      {events.length === 0 ? (
        <Empty title="No events yet" action={<Button variant="primary" onClick={() => setOpen(true)}>Create the first event</Button>}>
          An event holds its preorder batches, orders, planning, and wrap-up.
        </Empty>
      ) : (
        <TableWrap>
          <thead><tr><th>Event</th><th>Dates</th><th>Venue</th><th>Batches</th><th className="num">Open orders</th><th>Status</th></tr></thead>
          <tbody>
            {events.map((e) => {
              const bs = batches.filter((b) => b.eventId === e.id);
              const openCount = openOrders.filter((o) => o.eventId === e.id).length;
              return (
                <tr key={e.id} className="clickable" onClick={() => router.push(`/events/view/?id=${e.id}`)}>
                  <td className="font-semibold">{e.name}</td>
                  <td className="whitespace-nowrap">{formatDate(e.startDate)}{e.endDate !== e.startDate && ` – ${formatDate(e.endDate)}`}</td>
                  <td className="text-ink-2">{e.venue}</td>
                  <td className="flex flex-wrap gap-1">{bs.map((b) => <span key={b.id} className="inline-flex items-center gap-1 text-sm">B{b.number} <StatusPill status={b.status} /></span>)}</td>
                  <td className="num">{openCount}</td>
                  <td><StatusPill status={e.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New event" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={create} busy={busy} disabled={!d.name.trim()}>Create</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus /></Field>
          <Field label="First day"><Input type="date" value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} /></Field>
          <Field label="Last day"><Input type="date" value={d.endDate} onChange={(e) => setD({ ...d, endDate: e.target.value })} /></Field>
          <Field label="Venue and booth" className="sm:col-span-2"><Input value={d.venue} onChange={(e) => setD({ ...d, venue: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
