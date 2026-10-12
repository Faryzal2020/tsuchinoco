'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { eventRepo, movementRepo, orderRepo, wrapupRepo } from '@/lib/repo';
import { walkinRevenue, wrapupRows } from '@/lib/compute';
import { addDaysIso, formatDateTime, formatMoney } from '@/lib/format';
import type { StockMovement } from '@/types';
import Button from '@/components/ui/Button';
import { NumberCell, Textarea } from '@/components/ui/Field';
import { Empty, Panel, Pill, Stat, StatusPill, TableWrap } from '@/components/ui/Bits';
import { Confirm, Modal } from '@/components/ui/Dialog';
import { useVariantLabel } from '@/components/VariantSelect';
import type { TabProps } from './types';

export default function WrapupTab({ event, orders }: TabProps) {
  const { me } = useAuth();
  const { items, itemsById, movements, openOrders, wrapups, settings, staffName } = useData();
  const { run } = useToast();
  const labelOf = useVariantLabel();
  const wrapup = wrapups.find((w) => w.id === event.id);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [unfinal, setUnfinal] = useState(false);
  const [unfinalNote, setUnfinalNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!wrapup) wrapupRepo.ensure(event.id, me).catch(console.error); }, [wrapup, event.id, me]);

  const rows = useMemo(() => wrapupRows(wrapup, orders, items, movements, openOrders)
    .map((r) => ({ ...r, label: labelOf(r.itemId, r.variantId) }))
    .sort((a, b) => a.label.item.localeCompare(b.label.item) || a.label.variant.localeCompare(b.label.variant)),
  [wrapup, orders, items, movements, openOrders, labelOf]);

  const bundles = items.filter((i) => i.kind === 'bundle' && i.active);
  const locked = wrapup?.status === 'finalized';
  const revenue = walkinRevenue(rows, wrapup?.bundlesSold ?? {}, itemsById);
  const problems = rows.filter((r) => r.looseUnits !== null && r.looseUnits < 0);
  const incomplete = rows.filter((r) => r.brought === null || r.leftover === null);
  const awaitingPickup = orders.filter((o) => o.status === 'awaiting_pickup');

  const setCell = (key: string, field: 'brought' | 'leftover', v: number | null) => run(() => wrapupRepo.setCell(event.id, key, field, v, me));
  const fillBrought = () => run(async () => {
    for (const r of rows) if (r.brought === null) await wrapupRepo.setCell(event.id, r.key, 'brought', r.onHand, me);
  }, 'Brought filled from on-hand');

  const finalize = async () => {
    setBusy(true);
    await run(async () => {
      const mv: Omit<StockMovement, 'id' | 'createdAt' | 'createdBy'>[] = [];
      for (const r of rows) {
        if (r.pickupsCollected > 0) mv.push({ itemId: r.itemId, variantId: r.variantId, qty: -r.pickupsCollected, reason: 'pickup', eventId: event.id, note: `${event.name} pickups collected` });
        if (r.walkinSold && r.walkinSold > 0) mv.push({ itemId: r.itemId, variantId: r.variantId, qty: -r.walkinSold, reason: 'walkin', eventId: event.id, note: `${event.name} walk-in sales` });
      }
      const ids = await movementRepo.bulkCreate(mv, me);
      const deadline = addDaysIso(event.endDate, event.pickupDeadlineDays);
      for (const o of awaitingPickup) await orderRepo.setStatus(o, 'not_collected', me, { returnToStockBy: deadline });
      await wrapupRepo.patch(event.id, { status: 'finalized', finalizedAt: Date.now(), finalizedBy: me, movementIds: ids }, me);
      await eventRepo.patch(event.id, { status: 'wrapped' }, me);
    }, 'Wrap-up finalised');
    setBusy(false);
    setConfirmFinal(false);
  };

  const unfinalize = async () => {
    if (!wrapup || !unfinalNote.trim()) return;
    setBusy(true);
    await run(async () => {
      const posted = movements.filter((m) => wrapup.movementIds.includes(m.id));
      await movementRepo.bulkCreate(posted.map((m) => ({ itemId: m.itemId, variantId: m.variantId, qty: -m.qty, reason: 'reversal' as const, eventId: event.id, note: `Un-finalise: ${unfinalNote.trim()}` })), me);
      await wrapupRepo.patch(event.id, { status: 'draft', movementIds: [] }, me);
      await eventRepo.patch(event.id, { status: 'upcoming' }, me);
    }, 'Wrap-up reopened, movements reversed');
    setBusy(false);
    setUnfinal(false);
    setUnfinalNote('');
  };

  if (!wrapup) return <Empty title="Preparing wrap-up…" />;

  let last = '';
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Status" value={<StatusPill status={wrapup.status} />} sub={wrapup.finalizedAt ? `by ${staffName(wrapup.finalizedBy ?? '')}, ${formatDateTime(wrapup.finalizedAt)}` : `last edit ${formatDateTime(wrapup.updatedAt)}`} />
        <Stat label="Walk-in revenue" value={formatMoney(revenue, settings.currency)} tone="yellow" />
        <Stat label="Rows incomplete" value={incomplete.length} sub="brought or leftover missing" />
        <Stat label="Pickups still waiting" value={awaitingPickup.length} sub={awaitingPickup.length > 0 ? 'finalising marks them not collected' : 'all reconciled'} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!locked && <Button size="sm" onClick={fillBrought} disabled={rows.every((r) => r.brought !== null)}>Fill brought from on-hand</Button>}
        {!locked && awaitingPickup.length > 0 && <Button size="sm" href={`/events/view/?id=${event.id}&tab=orders&view=pickup`}>Reconcile pickups</Button>}
        <span className="flex-1" />
        {!locked ? (
          <Button variant="primary" disabled={problems.length > 0 || rows.length === 0} onClick={() => setConfirmFinal(true)}>Finalise wrap-up</Button>
        ) : (
          <Button variant="danger" onClick={() => setUnfinal(true)}>Un-finalise</Button>
        )}
      </div>
      {problems.length > 0 && <p className="mb-3 rounded-md bg-red-soft px-3 py-2 text-sm text-red-ink">{problems.length} rows have more bundle units than walk-in units. Lower the bundles sold or check the counts.</p>}

      {rows.length === 0 ? <Empty title="Nothing to count">No stock and no orders for this event yet.</Empty> : (
        <TableWrap>
          <thead><tr><th>Item</th><th>Variant</th><th className="num">On hand</th><th className="num">Brought</th><th className="num">Pickups collected</th><th className="num">Leftover</th><th className="num">Walk-in sold</th><th className="num">In bundles</th><th>Edited by</th></tr></thead>
          <tbody>
            {rows.map((r) => { const first = last !== r.label.item; last = r.label.item; return (
              <tr key={r.key}>
                <td className="font-semibold">{first ? r.label.item : ''}</td>
                <td>{r.label.variant || '—'}</td>
                <td className="num text-ink-2">{r.onHand}</td>
                <td className="num"><NumberCell value={r.brought} allowNull min={0} disabled={locked} onCommit={(v) => setCell(r.key, 'brought', v)} /></td>
                <td className="num">{r.pickupsCollected}</td>
                <td className="num"><NumberCell value={r.leftover} allowNull min={0} disabled={locked} onCommit={(v) => setCell(r.key, 'leftover', v)} /></td>
                <td className={`num font-bold ${r.walkinSold !== null && r.walkinSold < 0 ? 'text-red-ink' : ''}`}>{r.walkinSold ?? ''}</td>
                <td className={`num ${r.looseUnits !== null && r.looseUnits < 0 ? 'text-red-ink' : 'text-ink-2'}`}>{r.bundleUnits || ''}</td>
                <td className="hint">{wrapup.rows[r.key]?.editedBy ? staffName(wrapup.rows[r.key].editedBy!) : ''}</td>
              </tr>
            ); })}
          </tbody>
        </TableWrap>
      )}

      {bundles.length > 0 && (
        <Panel className="mt-5">
          <h3 className="font-bold">Bundles sold on site</h3>
          <p className="hint mb-3">Count of each bundle sold at the booth. Their units are already inside walk-in sold; this only fixes the revenue split.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {bundles.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                <div><div className="font-semibold text-sm">{b.name}</div><div className="hint">{formatMoney(b.price, settings.currency)}</div></div>
                <NumberCell value={wrapup.bundlesSold[b.id] ?? 0} min={0} disabled={locked} onCommit={(v) => run(() => wrapupRepo.setBundleSold(event.id, b.id, v ?? 0, me))} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Confirm open={confirmFinal} onClose={() => setConfirmFinal(false)} onConfirm={finalize} busy={busy} title="Finalise wrap-up?" confirmLabel="Finalise">
        <ul className="list-disc pl-5 grid gap-1">
          <li>Posts pickup and walk-in stock movements for every row.</li>
          <li>Marks {awaitingPickup.length} uncollected pickup orders as not collected, returning to stock on {addDaysIso(event.endDate, event.pickupDeadlineDays)}.</li>
          <li>Locks the counts and sets the event to wrapped.</li>
          {incomplete.length > 0 && <li className="text-yellow-ink">{incomplete.length} rows are incomplete and will post nothing. <Pill tone="yellow">check</Pill></li>}
        </ul>
      </Confirm>
      <Modal open={unfinal} onClose={() => setUnfinal(false)} title="Un-finalise wrap-up" footer={<><Button onClick={() => setUnfinal(false)}>Cancel</Button><Button variant="danger" busy={busy} disabled={!unfinalNote.trim()} onClick={unfinalize}>Reverse and reopen</Button></>}>
        <p className="text-sm text-ink-2 mb-3">Writes reversal movements for everything this wrap-up posted, then unlocks the counts. Orders already marked not collected stay as they are.</p>
        <Textarea placeholder="Why? (required)" value={unfinalNote} onChange={(e) => setUnfinalNote(e.target.value)} />
      </Modal>
    </>
  );
}
