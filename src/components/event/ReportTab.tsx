'use client';

import React, { useMemo } from 'react';
import { useData } from '@/lib/data';
import { eventReport } from '@/lib/compute';
import { formatMoney } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import Button from '@/components/ui/Button';
import { Empty, Stat, TableWrap } from '@/components/ui/Bits';
import { useVariantLabel } from '@/components/VariantSelect';
import type { TabProps } from './types';

export default function ReportTab({ event, batches, orders }: TabProps) {
  const { items, movements, openOrders, wrapups, settings, itemsById, staffName } = useData();
  const labelOf = useVariantLabel();
  const wrapup = wrapups.find((w) => w.id === event.id);
  const report = useMemo(() => eventReport(event, batches, orders, wrapup, items, movements, openOrders), [event, batches, orders, wrapup, items, movements, openOrders]);
  const rows = report.rows.map((r) => ({ ...r, label: labelOf(r.itemId, r.variantId), manager: staffName(itemsById.get(r.itemId)?.managerId ?? '') }))
    .filter((r) => r.produced || r.soldPickup || r.soldWalkin || r.soldMail || r.leftover)
    .sort((a, b) => a.label.item.localeCompare(b.label.item) || a.label.variant.localeCompare(b.label.variant));
  const hasMargin = rows.some((r) => r.margin !== null);
  const cur = settings.currency;

  const exportCsv = () => downloadCsv(`${event.name}-report`, toCsv(rows.map((r) => ({
    manager: r.manager, item: r.label.item, variant: r.label.variant, produced: r.produced, soldPickup: r.soldPickup, soldWalkin: r.soldWalkin, soldMail: r.soldMail,
    leftover: r.leftover ?? '', leftoverValue: r.leftoverValue, revenue: r.revenue, margin: r.margin ?? '',
  }))));

  const notFinal = !wrapup || wrapup.status !== 'finalized';
  let last = '';
  return (
    <>
      {notFinal && <p className="mb-4 rounded-md bg-yellow-soft px-3 py-2 text-sm text-yellow-ink">The wrap-up is not finalised. Walk-in and leftover figures are provisional.</p>}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Pickup preorders" value={formatMoney(report.preorderPickup, cur)} />
        <Stat label="Mail preorders" value={formatMoney(report.preorderMail, cur)} />
        <Stat label="Walk-in" value={formatMoney(report.walkin, cur)} />
        <Stat label="Post-event mail" value={formatMoney(report.postMail, cur)} />
        <Stat label="Total" value={formatMoney(report.total, cur)} tone="yellow" />
      </div>
      <div className="mb-3 flex items-center">
        <span className="hint">Revenue per variant uses order prices and the bundle split. Leftover value is at list price.</span>
        <Button size="sm" className="ml-auto" onClick={exportCsv}>Export CSV</Button>
      </div>
      {rows.length === 0 ? <Empty title="Nothing to report yet" /> : (
        <TableWrap>
          <thead><tr><th>Item</th><th>Variant</th><th className="num">Produced</th><th className="num">Pickup</th><th className="num">Walk-in</th><th className="num">Mail</th><th className="num">Sold</th><th className="num">Leftover</th><th className="num">Leftover value</th><th className="num">Revenue</th>{hasMargin && <th className="num">Margin</th>}</tr></thead>
          <tbody>
            {rows.map((r) => { const first = last !== r.label.item; last = r.label.item; const sold = r.soldPickup + r.soldWalkin + r.soldMail; return (
              <tr key={r.key}>
                <td className="font-semibold">{first ? r.label.item : ''}</td>
                <td>{r.label.variant || '—'}</td>
                <td className="num">{r.produced}</td>
                <td className="num">{r.soldPickup}</td>
                <td className="num">{r.soldWalkin}</td>
                <td className="num">{r.soldMail}</td>
                <td className="num font-semibold">{sold}</td>
                <td className="num">{r.leftover ?? '—'}</td>
                <td className="num text-ink-2">{formatMoney(r.leftoverValue, cur)}</td>
                <td className="num font-semibold">{formatMoney(r.revenue, cur)}</td>
                {hasMargin && <td className="num">{r.margin === null ? '—' : formatMoney(r.margin, cur)}</td>}
              </tr>
            ); })}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
