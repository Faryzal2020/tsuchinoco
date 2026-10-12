'use client';

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { usePrefs } from '@/lib/prefs';
import { useToast } from '@/components/ui/Toast';
import { useQuery } from '@/lib/useQuery';
import { batchRepo, movementRepo } from '@/lib/repo';
import { planningRows, type PlanningRow } from '@/lib/compute';
import { downloadCsv, toCsv } from '@/lib/csv';
import Button from '@/components/ui/Button';
import { NumberCell, Select } from '@/components/ui/Field';
import { Empty, Pill, TableWrap } from '@/components/ui/Bits';
import { Confirm } from '@/components/ui/Dialog';
import { useVariantLabel } from '@/components/VariantSelect';
import type { TabProps } from './types';

type Row = PlanningRow & { label: { item: string; variant: string }; manager: string };

export default function PlanningTab({ event, batches, orders }: TabProps) {
  const { me } = useAuth();
  const { items, itemsById, movements, openOrders, staffName } = useData();
  const { isMine } = usePrefs();
  const { run, toast } = useToast();
  const { get, set } = useQuery();
  const labelOf = useVariantLabel();
  const batchId = get('batch') || batches.find((b) => b.status === 'open')?.id || batches.at(-1)?.id || '';
  const batch = batches.find((b) => b.id === batchId);
  const [pendingReceive, setPendingReceive] = useState<{ row: Row; value: number } | null>(null);

  const rows = useMemo(() => {
    if (!batch) return [];
    return planningRows(batch, batches, orders.filter((o) => o.batchId === batch.id), items, movements, openOrders)
      .filter((r) => isMine(itemsById.get(r.itemId)))
      .map((r) => ({ ...r, label: labelOf(r.itemId, r.variantId), manager: staffName(itemsById.get(r.itemId)?.managerId ?? '') }))
      .sort((a, b) => a.manager.localeCompare(b.manager) || a.label.item.localeCompare(b.label.item) || a.label.variant.localeCompare(b.label.variant));
  }, [batch, batches, orders, items, movements, openOrders, isMine, itemsById, labelOf, staffName]);

  if (!batch) return <Empty title="No batch to plan">Add a batch on the Batches tab first.</Empty>;

  const save = (key: string, field: 'onsiteExtra' | 'ordered', v: number | null) =>
    run(() => batchRepo.setPlanningCell(batch.id, key, field, v ?? 0, me));

  const confirmReceive = async () => {
    if (!pendingReceive) return;
    const { row, value } = pendingReceive;
    const diff = value - row.received;
    await run(async () => {
      await batchRepo.setPlanningCell(batch.id, row.key, 'received', value, me);
      if (diff !== 0) await movementRepo.create({ itemId: row.itemId, variantId: row.variantId, qty: diff, reason: 'received', eventId: event.id, batchId: batch.id, note: `Batch ${batch.number} production received` }, me);
    }, diff !== 0 ? `Received ${diff > 0 ? '+' : ''}${diff} posted to stock` : 'Saved');
    setPendingReceive(null);
  };

  const copyMine = () => {
    const mine = rows.filter((r) => r.netToOrder > r.ordered);
    const text = mine.map((r) => `${r.label.item}${r.label.variant ? ` (${r.label.variant})` : ''}: ${r.netToOrder - r.ordered}`).join('\n');
    navigator.clipboard?.writeText(text);
    toast(`Copied ${mine.length} lines`);
  };

  const exportCsv = () => downloadCsv(`${event.name}-batch${batch.number}-planning`, toCsv(rows.map((r) => ({
    manager: r.manager, item: r.label.item, variant: r.label.variant, pickup: r.preorderPickup, mail: r.preorderMail, onsiteExtra: r.onsiteExtra,
    onHand: r.onHand, committed: r.committed, available: r.available, incoming: r.incoming, netToOrder: r.netToOrder, ordered: r.ordered, received: r.received,
  }))));

  const totals = rows.reduce((t, r) => ({ net: t.net + r.netToOrder, short: t.short + (r.netToOrder > r.ordered ? 1 : 0) }), { net: 0, short: 0 });
  let lastMgr = '';
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select small value={batch.id} onChange={(e) => set({ batch: e.target.value })} className="w-[150px]">{batches.map((b) => <option key={b.id} value={b.id}>Batch {b.number}</option>)}</Select>
        <span className="hint">{rows.length} variants · {totals.net} units to order · {totals.short} rows still short</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={copyMine}>Copy to-order lines</Button>
          <Button size="sm" onClick={exportCsv}>Export CSV</Button>
        </div>
      </div>
      <p className="hint mb-3">
        Net to order = pickup + mail + on-site extra − available − incoming. Available is on hand minus everything committed to open orders in any event. Incoming is ordered but not yet received in the other batches of this event. Confirming a received quantity posts the difference to stock.
      </p>
      {rows.length === 0 ? <Empty title="Nothing to plan">Add items to this batch&apos;s offering, or wait for orders.</Empty> : (
        <TableWrap>
          <thead>
            <tr>
              <th>Item</th><th>Variant</th>
              <th className="num" title="Preorders for pickup">Pickup</th><th className="num" title="Preorders for mail">Mail</th>
              <th className="num">On-site extra</th>
              <th className="num">On hand</th><th className="num">Committed</th><th className="num">Available</th><th className="num">Incoming</th>
              <th className="num">Net to order</th><th className="num">Ordered</th><th className="num">Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const first = lastMgr !== r.manager; lastMgr = r.manager;
              const short = r.netToOrder > r.ordered;
              return (
                <React.Fragment key={r.key}>
                  {first && <tr className="group"><td colSpan={12}>{r.manager || 'Unassigned'}</td></tr>}
                  <tr>
                    <td className="font-semibold">{r.label.item}</td>
                    <td>{r.label.variant || '—'}</td>
                    <td className="num">{r.preorderPickup}</td>
                    <td className="num">{r.preorderMail}</td>
                    <td className="num"><NumberCell value={r.onsiteExtra} min={0} onCommit={(v) => save(r.key, 'onsiteExtra', v)} disabled={batch.mode === 'post'} /></td>
                    <td className="num">{r.onHand}</td>
                    <td className="num">{r.committed}</td>
                    <td className={`num ${r.available < 0 ? 'text-red-ink' : ''}`}>{r.available}</td>
                    <td className="num">{r.incoming || ''}</td>
                    <td className="num"><span className="font-bold">{r.netToOrder}</span>{short && <Pill tone="yellow" className="ml-1">short</Pill>}</td>
                    <td className="num"><NumberCell value={r.ordered} min={0} onCommit={(v) => save(r.key, 'ordered', v)} /></td>
                    <td className="num"><NumberCell value={r.received} min={0} onCommit={(v) => { if ((v ?? 0) !== r.received) setPendingReceive({ row: r, value: v ?? 0 }); }} /></td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </TableWrap>
      )}
      <Confirm open={!!pendingReceive} onClose={() => setPendingReceive(null)} onConfirm={confirmReceive} title="Confirm received quantity" confirmLabel="Post to stock">
        {pendingReceive && <>Set received for <b>{pendingReceive.row.label.item}{pendingReceive.row.label.variant && ` · ${pendingReceive.row.label.variant}`}</b> to <b>{pendingReceive.value}</b>. Stock changes by {pendingReceive.value - pendingReceive.row.received > 0 ? '+' : ''}{pendingReceive.value - pendingReceive.row.received}.</>}
      </Confirm>
    </>
  );
}
