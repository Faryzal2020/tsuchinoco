'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useData } from '@/lib/data';
import { formatDateTime } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import type { MovementReason } from '@/types';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Empty, PageHeader, StatusPill, TableWrap } from '@/components/ui/Bits';
import { VariantSelect, useVariantLabel } from '@/components/VariantSelect';
import { QueryPage, useQuery } from '@/lib/useQuery';

const REASONS: MovementReason[] = ['opening', 'received', 'pickup', 'walkin', 'shipped', 'correction', 'reversal'];

function Ledger() {
  const { movements, events, staffName } = useData();
  const { get, set } = useQuery();
  const labelOf = useVariantLabel();
  const key = get('variant');
  const reason = get('reason');
  const eventId = get('event');

  const rows = useMemo(() => movements.filter((m) => {
    if (key && `${m.itemId}:${m.variantId}` !== key) return false;
    if (reason && m.reason !== reason) return false;
    if (eventId && m.eventId !== eventId) return false;
    return true;
  }).slice(0, 500), [movements, key, reason, eventId]);

  const exportCsv = () => downloadCsv('stock-movements', toCsv(rows.map((m) => {
    const l = labelOf(m.itemId, m.variantId);
    return { when: formatDateTime(m.createdAt), item: l.item, variant: l.variant, qty: m.qty, reason: m.reason, event: events.find((e) => e.id === m.eventId)?.name ?? '', order: m.orderId ?? '', note: m.note, by: staffName(m.createdBy) };
  })));

  return (
    <>
      <PageHeader title="Movement ledger" actions={<><Button onClick={exportCsv}>Export CSV</Button><Button href="/stock/">Back to stock</Button></>}>
        Every change to stock, newest first. Showing up to 500 rows.
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <VariantSelect value={key} onChange={(k) => set({ variant: k })} placeholder="All variants" className="w-[260px]" />
        <Select value={reason} onChange={(e) => set({ reason: e.target.value })} className="w-[150px]">
          <option value="">All reasons</option>
          {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Select value={eventId} onChange={(e) => set({ event: e.target.value })} className="w-[200px]">
          <option value="">All events</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
      </div>
      {rows.length === 0 ? <Empty title="No movements" /> : (
        <TableWrap>
          <thead><tr><th>When</th><th>Item</th><th>Variant</th><th className="num">Qty</th><th>Reason</th><th>Event / order</th><th>Note</th><th>By</th></tr></thead>
          <tbody>
            {rows.map((m) => {
              const l = labelOf(m.itemId, m.variantId);
              const ev = events.find((e) => e.id === m.eventId);
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                  <td className="font-semibold">{l.item}</td>
                  <td>{l.variant || '—'}</td>
                  <td className={`num font-semibold ${m.qty < 0 ? 'text-red-ink' : 'text-green-ink'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                  <td><StatusPill status={m.reason} /></td>
                  <td className="text-ink-2">
                    {ev && <Link href={`/events/view/?id=${ev.id}`} className="text-blue-ink">{ev.name}</Link>}
                    {m.orderId && <span className="mono"> {m.orderId.slice(0, 6)}</span>}
                  </td>
                  <td className="text-ink-2 max-w-[280px] truncate" title={m.note}>{m.note}</td>
                  <td className="text-ink-2">{staffName(m.createdBy)}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}

export default function Page() {
  return <QueryPage><Ledger /></QueryPage>;
}
