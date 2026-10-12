'use client';

import React, { useMemo, useState } from 'react';
import { useData } from '@/lib/data';
import { usePrefs } from '@/lib/prefs';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { movementRepo } from '@/lib/repo';
import { stockRows } from '@/lib/compute';
import { splitKey } from '@/lib/keys';
import { titleCase } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import Button from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Empty, PageHeader, Pill, Stat, TableWrap } from '@/components/ui/Bits';
import { Modal } from '@/components/ui/Dialog';
import { VariantSelect, useVariantLabel } from '@/components/VariantSelect';
import { QueryPage, useQuery } from '@/lib/useQuery';

function StockOverview() {
  const { items, itemsById, staff, movements, openOrders, settings, staffName } = useData();
  const { isMine } = usePrefs();
  const { me } = useAuth();
  const { run } = useToast();
  const { get, set } = useQuery();
  const labelOf = useVariantLabel();
  const type = get('type');
  const manager = get('manager');
  const onlyShort = get('short') === '1';

  const rows = useMemo(() => stockRows(items, movements, openOrders).filter((r) => {
    const item = itemsById.get(r.itemId);
    if (type && item?.type !== type) return false;
    if (manager && item?.managerId !== manager) return false;
    if (!isMine(item)) return false;
    if (onlyShort && r.available > 0) return false;
    return true;
  }).sort((a, b) => (itemsById.get(a.itemId)?.name ?? '').localeCompare(itemsById.get(b.itemId)?.name ?? '') || a.variantId.localeCompare(b.variantId)),
  [items, movements, openOrders, itemsById, type, manager, isMine, onlyShort]);

  const totals = rows.reduce((t, r) => ({ onHand: t.onHand + r.onHand, committed: t.committed + r.committed, short: t.short + (r.available <= 0 ? 1 : 0) }), { onHand: 0, committed: 0, short: 0 });

  // Correction modal
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const postCorrection = async () => {
    const n = Number(qty);
    if (!key || !Number.isFinite(n) || n === 0 || !note.trim()) return;
    setBusy(true);
    const { itemId, variantId } = splitKey(key);
    const ok = await run(() => movementRepo.create({ itemId, variantId, qty: Math.round(n), reason: 'correction', note: note.trim() }, me), 'Correction posted');
    setBusy(false);
    if (ok) { setOpen(false); setKey(''); setQty(''); setNote(''); }
  };

  const exportCsv = () => downloadCsv('stock', toCsv(rows.map((r) => {
    const l = labelOf(r.itemId, r.variantId);
    return { item: l.item, variant: l.variant, onHand: r.onHand, committed: r.committed, available: r.available };
  })));

  let lastItem = '';
  return (
    <>
      <PageHeader
        title="Stock"
        actions={
          <>
            <Button onClick={exportCsv}>Export CSV</Button>
            <Button href="/stock/ledger/">Movement ledger</Button>
            <Button onClick={() => setOpen(true)}>Add correction</Button>
            <Button variant="primary" href="/stock/take/">Stock take</Button>
          </>
        }
      >
        On hand is the ledger total. Committed is promised to open orders across every event. Available is what planning can use.
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Units on hand" value={totals.onHand} />
        <Stat label="Units committed" value={totals.committed} tone="yellow" />
        <Stat label="Variants short" value={totals.short} sub="available at or below zero" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={type} onChange={(e) => set({ type: e.target.value })} className="w-[160px]">
          <option value="">All types</option>
          {settings.itemTypes.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </Select>
        <Select value={manager} onChange={(e) => set({ manager: e.target.value })} className="w-[180px]">
          <option value="">All managers</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        </Select>
        <Button size="sm" data-pressed={onlyShort ? 'true' : undefined} onClick={() => set({ short: onlyShort ? null : '1' })}>Short only</Button>
      </div>

      {rows.length === 0 ? <Empty title="No stock rows">Run a stock take to enter opening counts.</Empty> : (
        <TableWrap>
          <thead><tr><th>Item</th><th>Variant</th><th>Manager</th><th className="num">On hand</th><th className="num">Committed</th><th className="num">Available</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const item = itemsById.get(r.itemId);
              const l = labelOf(r.itemId, r.variantId);
              const first = lastItem !== r.itemId; lastItem = r.itemId;
              return (
                <tr key={r.key}>
                  <td className="font-semibold">{first ? l.item : ''}</td>
                  <td>{l.variant || '—'}</td>
                  <td className="text-ink-2">{first && item ? staffName(item.managerId) : ''}</td>
                  <td className="num">{r.onHand}</td>
                  <td className="num">{r.committed}</td>
                  <td className="num font-semibold">{r.available}</td>
                  <td>{r.available <= 0 && <Pill tone="red">Short</Pill>}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add stock correction"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={postCorrection} busy={busy} disabled={!key || !qty || !note.trim()}>Post correction</Button></>}>
        <div className="grid gap-3">
          <Field label="Variant"><VariantSelect value={key} onChange={setKey} /></Field>
          <Field label="Quantity change" hint="Positive adds stock, negative removes it."><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Reason note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. found a box in storage / damaged in transit" /></Field>
        </div>
      </Modal>
    </>
  );
}

export default function Page() {
  return <QueryPage><StockOverview /></QueryPage>;
}
