'use client';

import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { usePrefs } from '@/lib/prefs';
import { useToast } from '@/components/ui/Toast';
import { batchRepo, movementRepo } from '@/lib/repo';
import { stockRows, offeringKeys } from '@/lib/compute';
import { splitKey, variantKey } from '@/lib/keys';
import { downloadCsv, toCsv } from '@/lib/csv';
import Button from '@/components/ui/Button';
import { Input, NumberCell, Select } from '@/components/ui/Field';
import { Empty, Pill, TableWrap } from '@/components/ui/Bits';
import { Confirm } from '@/components/ui/Dialog';
import { useVariantLabel } from '@/components/VariantSelect';
import { titleCase } from '@/lib/format';
import type { TabProps } from './types';

interface BatchCellData {
  pickup: number;
  mail: number;
  subtotal: number;
}

interface EventPlanningRow {
  key: string;
  itemId: string;
  variantId: string;
  label: { item: string; variant: string };
  manager: string;
  batchData: Record<string, BatchCellData>;
  totalPreorder: number;
  onsiteExtra: number;
  totalDemand: number;
  onHand: number;
  committed: number;
  available: number;
  netToOrder: number;
  ordered: number;
  received: number;
}

const BATCH_THEMES = [
  {
    // Blue / Sky
    header: 'bg-sky-100 text-sky-950 border-x border-sky-300',
    subHeader: 'bg-sky-50 text-sky-900 border-b border-sky-200',
    pickupCell: 'bg-sky-50/30 text-sky-950',
    mailCell: 'bg-sky-50/30 text-sky-950',
    subtotalCell: 'bg-sky-100/60 font-semibold text-sky-950 border-r border-sky-200',
    badge: 'bg-sky-200 text-sky-900',
  },
  {
    // Emerald / Green
    header: 'bg-emerald-100 text-emerald-950 border-x border-emerald-300',
    subHeader: 'bg-emerald-50 text-emerald-900 border-b border-emerald-200',
    pickupCell: 'bg-emerald-50/30 text-emerald-950',
    mailCell: 'bg-emerald-50/30 text-emerald-950',
    subtotalCell: 'bg-emerald-100/60 font-semibold text-emerald-950 border-r border-emerald-200',
    badge: 'bg-emerald-200 text-emerald-900',
  },
  {
    // Purple / Violet
    header: 'bg-purple-100 text-purple-950 border-x border-purple-300',
    subHeader: 'bg-purple-50 text-purple-900 border-b border-purple-200',
    pickupCell: 'bg-purple-50/30 text-purple-950',
    mailCell: 'bg-purple-50/30 text-purple-950',
    subtotalCell: 'bg-purple-100/60 font-semibold text-purple-950 border-r border-purple-200',
    badge: 'bg-purple-200 text-purple-900',
  },
  {
    // Amber / Orange
    header: 'bg-amber-100 text-amber-950 border-x border-amber-300',
    subHeader: 'bg-amber-50 text-amber-900 border-b border-amber-200',
    pickupCell: 'bg-amber-50/30 text-amber-950',
    mailCell: 'bg-amber-50/30 text-amber-950',
    subtotalCell: 'bg-amber-100/60 font-semibold text-amber-950 border-r border-amber-200',
    badge: 'bg-amber-200 text-amber-900',
  },
  {
    // Rose / Coral
    header: 'bg-rose-100 text-rose-950 border-x border-rose-300',
    subHeader: 'bg-rose-50 text-rose-900 border-b border-rose-200',
    pickupCell: 'bg-rose-50/30 text-rose-950',
    mailCell: 'bg-rose-50/30 text-rose-950',
    subtotalCell: 'bg-rose-100/60 font-semibold text-rose-950 border-r border-rose-200',
    badge: 'bg-rose-200 text-rose-900',
  },
];

export default function PlanningTab({ event, batches, orders }: TabProps) {
  const { me } = useAuth();
  const { items, itemsById, movements, openOrders, staff, settings, staffName } = useData();
  const { isMine } = usePrefs();
  const { run, toast } = useToast();
  const labelOf = useVariantLabel();

  // Batches sorted by batch number
  const sortedBatches = useMemo(() => [...batches].sort((a, b) => a.number - b.number), [batches]);

  // Target batch for editing production inputs
  const [targetBatchId, setTargetBatchId] = useState<string>(() => {
    return batches.find((b) => b.status === 'open')?.id || batches.at(-1)?.id || '';
  });

  const targetBatch = useMemo(() => {
    return sortedBatches.find((b) => b.id === targetBatchId)
      || sortedBatches.find((b) => b.status === 'open')
      || sortedBatches.at(-1)
      || sortedBatches[0];
  }, [sortedBatches, targetBatchId]);

  const [pendingReceive, setPendingReceive] = useState<{ row: EventPlanningRow; value: number } | null>(null);

  // Search & filter states
  const [search, setSearch] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [shortOnly, setShortOnly] = useState(false);

  // Sorting state
  const [sortCol, setSortCol] = useState<string>('manager');
  const [sortAsc, setSortAsc] = useState(true);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortAsc((prev) => !prev);
    else { setSortCol(col); setSortAsc(true); }
  };

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.category) s.add(i.category); });
    return [...s].sort();
  }, [items]);

  // Compute all planning rows for the entire event
  const rawRows = useMemo(() => {
    if (sortedBatches.length === 0) return [];

    const stockMap = new Map(stockRows(items, movements, openOrders).map((r) => [r.key, r]));

    // Maps per batch: batchId -> pickup Map & mail Map
    const pickupByBatch = new Map<string, Map<string, number>>();
    const mailByBatch = new Map<string, Map<string, number>>();

    for (const b of sortedBatches) {
      pickupByBatch.set(b.id, new Map<string, number>());
      mailByBatch.set(b.id, new Map<string, number>());
    }

    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const bPickup = pickupByBatch.get(o.batchId);
      const bMail = mailByBatch.get(o.batchId);
      const targetMap = o.fulfilment === 'pickup' ? bPickup : bMail;
      if (!targetMap) continue;

      for (const l of o.lines) {
        const k = variantKey(l.itemId, l.variantId);
        targetMap.set(k, (targetMap.get(k) ?? 0) + l.qty);
      }
    }

    // Collect all relevant variant keys for this event
    const keys = new Set<string>();
    for (const b of sortedBatches) {
      for (const k of offeringKeys(b, itemsById)) keys.add(k);
      for (const [k, p] of Object.entries(b.planning ?? {})) {
        if ((p?.onsiteExtra || p?.ordered || p?.received)) keys.add(k);
      }
    }
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      for (const l of o.lines) keys.add(variantKey(l.itemId, l.variantId));
    }

    const rows: EventPlanningRow[] = [];

    for (const key of keys) {
      const { itemId, variantId } = splitKey(key);
      const it = itemsById.get(itemId);
      if (!isMine(it)) continue;

      const s = stockMap.get(key);
      const onHand = s?.onHand ?? 0;
      const committed = s?.committed ?? 0;
      const available = s?.available ?? 0;

      let totalPreorder = 0;
      const batchData: Record<string, BatchCellData> = {};

      for (const b of sortedBatches) {
        const pMap = pickupByBatch.get(b.id);
        const mMap = mailByBatch.get(b.id);
        const pVal = pMap?.get(key) ?? 0;
        const mVal = mMap?.get(key) ?? 0;
        const sub = pVal + mVal;
        batchData[b.id] = { pickup: pVal, mail: mVal, subtotal: sub };
        totalPreorder += sub;
      }

      // Production inputs:
      // When targetBatch is selected, onsiteExtra, ordered, received are edited for targetBatch.
      // We also aggregate overall event production:
      const onsiteExtra = targetBatch?.planning?.[key]?.onsiteExtra ?? 0;
      const ordered = targetBatch?.planning?.[key]?.ordered ?? 0;
      const received = targetBatch?.planning?.[key]?.received ?? 0;

      // Aggregated totals across all batches for demand / net calculations
      const totalOnsite = sortedBatches.reduce((acc, b) => acc + (b.planning?.[key]?.onsiteExtra ?? 0), 0);
      const totalDemand = totalPreorder + totalOnsite;
      const totalOrdered = sortedBatches.reduce((acc, b) => acc + (b.planning?.[key]?.ordered ?? 0), 0);
      const totalReceived = sortedBatches.reduce((acc, b) => acc + (b.planning?.[key]?.received ?? 0), 0);
      const pendingInProduction = Math.max(0, totalOrdered - totalReceived);

      const netToOrder = Math.max(0, totalDemand - available - pendingInProduction);

      rows.push({
        key,
        itemId,
        variantId,
        label: labelOf(itemId, variantId),
        manager: staffName(it?.managerId ?? ''),
        batchData,
        totalPreorder,
        onsiteExtra,
        totalDemand,
        onHand,
        committed,
        available,
        netToOrder,
        ordered,
        received,
      });
    }

    return rows;
  }, [sortedBatches, orders, items, movements, openOrders, itemsById, isMine, labelOf, staffName, targetBatch]);

  const filteredRows = useMemo(() => {
    return rawRows.filter((r) => {
      const it = itemsById.get(r.itemId);
      if (managerFilter && it?.managerId !== managerFilter) return false;
      if (typeFilter && it?.type !== typeFilter) return false;
      if (categoryFilter && it?.category !== categoryFilter) return false;
      if (shortOnly && r.netToOrder <= 0) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchItem = r.label.item.toLowerCase().includes(q);
        const matchVar = r.label.variant.toLowerCase().includes(q);
        const matchMgr = r.manager.toLowerCase().includes(q);
        const matchCat = (it?.category || '').toLowerCase().includes(q);
        const matchSku = (it?.sku || '').toLowerCase().includes(q);
        if (!matchItem && !matchVar && !matchMgr && !matchCat && !matchSku) return false;
      }

      return true;
    });
  }, [rawRows, managerFilter, typeFilter, categoryFilter, shortOnly, search, itemsById]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'item') {
        cmp = a.label.item.localeCompare(b.label.item) || a.label.variant.localeCompare(b.label.variant);
      } else if (sortCol === 'variant') {
        cmp = a.label.variant.localeCompare(b.label.variant);
      } else if (sortCol === 'manager') {
        cmp = a.manager.localeCompare(b.manager) || a.label.item.localeCompare(b.label.item) || a.label.variant.localeCompare(b.label.variant);
      } else if (sortCol === 'totalPo') {
        cmp = a.totalPreorder - b.totalPreorder;
      } else if (sortCol === 'onsite') {
        cmp = a.onsiteExtra - b.onsiteExtra;
      } else if (sortCol === 'totalDemand') {
        cmp = a.totalDemand - b.totalDemand;
      } else if (sortCol === 'onHand') {
        cmp = a.onHand - b.onHand;
      } else if (sortCol === 'committed') {
        cmp = a.committed - b.committed;
      } else if (sortCol === 'available') {
        cmp = a.available - b.available;
      } else if (sortCol === 'net') {
        cmp = a.netToOrder - b.netToOrder;
      } else if (sortCol === 'ordered') {
        cmp = a.ordered - b.ordered;
      } else if (sortCol === 'received') {
        cmp = a.received - b.received;
      } else if (sortCol.startsWith('b_')) {
        const parts = sortCol.split('_');
        const bId = parts[1];
        const field = parts[2] as 'pickup' | 'mail' | 'subtotal';
        const valA = a.batchData[bId]?.[field] ?? 0;
        const valB = b.batchData[bId]?.[field] ?? 0;
        cmp = valA - valB;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [filteredRows, sortCol, sortAsc]);

  const hasActiveFilters = Boolean(search || managerFilter || typeFilter || categoryFilter || shortOnly);

  const resetFilters = () => {
    setSearch('');
    setManagerFilter('');
    setTypeFilter('');
    setCategoryFilter('');
    setShortOnly(false);
  };

  if (sortedBatches.length === 0) {
    return <Empty title="No batches in this event">Add a batch on the Batches tab first.</Empty>;
  }

  const save = (key: string, field: 'onsiteExtra' | 'ordered', v: number | null) => {
    if (!targetBatch) return;
    return run(() => batchRepo.setPlanningCell(targetBatch.id, key, field, v ?? 0, me));
  };

  const confirmReceive = async () => {
    if (!pendingReceive || !targetBatch) return;
    const { row, value } = pendingReceive;
    const diff = value - row.received;
    await run(async () => {
      await batchRepo.setPlanningCell(targetBatch.id, row.key, 'received', value, me);
      if (diff !== 0) {
        await movementRepo.create(
          {
            itemId: row.itemId,
            variantId: row.variantId,
            qty: diff,
            reason: 'received',
            eventId: event.id,
            batchId: targetBatch.id,
            note: `Batch ${targetBatch.number} production received`,
          },
          me
        );
      }
    }, diff !== 0 ? `Received ${diff > 0 ? '+' : ''}${diff} posted to stock` : 'Saved');
    setPendingReceive(null);
  };

  const copyMine = () => {
    const mine = sortedRows.filter((r) => r.netToOrder > 0);
    const text = mine
      .map((r) => `${r.label.item}${r.label.variant ? ` (${r.label.variant})` : ''}: ${r.netToOrder}`)
      .join('\n');
    navigator.clipboard?.writeText(text);
    toast(`Copied ${mine.length} lines`);
  };

  const exportCsv = () => {
    const data = sortedRows.map((r) => {
      const row: Record<string, string | number> = {
        manager: r.manager,
        item: r.label.item,
        variant: r.label.variant,
      };
      for (const b of sortedBatches) {
        const bd = r.batchData[b.id] ?? { pickup: 0, mail: 0, subtotal: 0 };
        row[`Batch ${b.number} Pickup`] = bd.pickup;
        row[`Batch ${b.number} Mail`] = bd.mail;
        row[`Batch ${b.number} Subtotal`] = bd.subtotal;
      }
      row['Total PO'] = r.totalPreorder;
      row['On-site Extra'] = r.onsiteExtra;
      row['Total Demand'] = r.totalDemand;
      row['On Hand'] = r.onHand;
      row['Committed'] = r.committed;
      row['Available'] = r.available;
      row['Net to Order'] = r.netToOrder;
      row['Ordered'] = r.ordered;
      row['Received'] = r.received;
      return row;
    });
    downloadCsv(`${event.name}-planning`, toCsv(data));
  };

  const totals = sortedRows.reduce(
    (t, r) => ({
      net: t.net + r.netToOrder,
      short: t.short + (r.netToOrder > 0 ? 1 : 0),
    }),
    { net: 0, short: 0 }
  );

  let lastMgr = '';

  return (
    <>
      {/* Top action row */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {sortedBatches.length > 1 ? (
          <div className="flex items-center gap-2 bg-white/90 px-3 py-1.5 rounded-xl border border-line shadow-xs">
            <span className="text-xs font-semibold text-ink-2">Production batch:</span>
            <Select
              small
              value={targetBatch?.id}
              onChange={(e) => setTargetBatchId(e.target.value)}
              className="w-auto font-medium"
            >
              {sortedBatches.map((b) => (
                <option key={b.id} value={b.id}>
                  Batch {b.number} {b.status === 'open' ? '(Open)' : `(${titleCase(b.status)})`}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <span className="text-xs font-bold text-ink-2 bg-cream-2 px-3 py-1.5 rounded-lg border border-line">
            Batch 1 ({titleCase(sortedBatches[0].status)})
          </span>
        )}

        <span className="hint">
          {sortedRows.length} variants · {totals.net} units net to order · {totals.short} rows short
        </span>

        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={copyMine}>Copy to-order lines</Button>
          <Button size="sm" onClick={exportCsv}>Export CSV</Button>
        </div>
      </div>

      {/* Filter toolbar matching Catalogue style */}
      <div className="mb-4 flex flex-wrap lg:flex-nowrap items-center gap-2 bg-white/95 p-2 rounded-xl border border-line shadow-xs">
        <Input
          placeholder="Search item, variant, SKU, manager, category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <Select small value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="w-auto min-w-[140px]">
          <option value="">All Managers</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        </Select>
        <Select small value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto min-w-[130px]">
          <option value="">All Types</option>
          {settings.itemTypes.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </Select>
        {allCategories.length > 0 && (
          <Select small value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-auto min-w-[130px]">
            <option value="">All Categories</option>
            {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}
        <Button
          size="sm"
          data-pressed={shortOnly ? 'true' : undefined}
          onClick={() => setShortOnly((prev) => !prev)}
        >
          Short only
        </Button>
        {hasActiveFilters && (
          <Button size="sm" variant="quiet" onClick={resetFilters}>
            Reset
          </Button>
        )}
      </div>

      <p className="hint mb-3">
        Scoped across the event with separate batch columns. Total demand = Total PO + On-site extra. Net to order = Total demand − Available − Pending production. Production inputs edit Batch {targetBatch?.number}. Confirming received quantities posts the difference directly to stock.
      </p>

      {sortedRows.length === 0 ? (
        <Empty
          title={hasActiveFilters ? 'No matching items' : 'Nothing to plan'}
          action={hasActiveFilters ? <Button size="sm" onClick={resetFilters}>Clear filters</Button> : undefined}
        >
          {hasActiveFilters
            ? 'Try broadening your search or resetting filters.'
            : 'Add items to batch offerings or wait for orders.'}
        </Empty>
      ) : (
        <TableWrap>
          <thead>
            {/* Row 1: High-level column groupings */}
            <tr>
              <th
                rowSpan={2}
                className="align-bottom cursor-pointer select-none hover:text-ink transition-colors pb-2.5 min-w-[160px]"
                onClick={() => toggleSort('item')}
                title="Sort by Item"
              >
                <div className="inline-flex items-center gap-1">
                  <span>Item</span>
                  <span className={`text-[10px] ${sortCol === 'item' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                    {sortCol === 'item' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>
              <th
                rowSpan={2}
                className="align-bottom cursor-pointer select-none hover:text-ink transition-colors pb-2.5 min-w-[110px]"
                onClick={() => toggleSort('variant')}
                title="Sort by Variant"
              >
                <div className="inline-flex items-center gap-1">
                  <span>Variant</span>
                  <span className={`text-[10px] ${sortCol === 'variant' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                    {sortCol === 'variant' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>

              {/* Distinct colored column groups for each batch */}
              {sortedBatches.map((b, idx) => {
                const theme = BATCH_THEMES[idx % BATCH_THEMES.length];
                const isActive = b.id === targetBatch?.id;
                return (
                  <th
                    key={b.id}
                    colSpan={3}
                    className={`text-center py-2 px-3 font-bold border-t border-b ${theme.header}`}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>Batch {b.number}</span>
                      {b.status === 'open' && (
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${theme.badge}`}>
                          Open
                        </span>
                      )}
                      {isActive && sortedBatches.length > 1 && (
                        <span className="text-[10px] font-semibold text-ink-2 bg-white/80 px-1 rounded border border-line/40">
                          Editing
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}

              {/* Event Preorders & Demand group */}
              <th
                colSpan={3}
                className="text-center py-2 px-3 font-bold bg-slate-100 text-slate-900 border-x border-slate-300"
              >
                Event Demand
              </th>

              {/* Stock Status group */}
              <th
                colSpan={3}
                className="text-center py-2 px-3 font-bold bg-stone-100 text-stone-900 border-x border-stone-300"
              >
                Stock Status
              </th>

              {/* Production group */}
              <th
                colSpan={3}
                className="text-center py-2 px-3 font-bold bg-indigo-100/80 text-indigo-950 border-x border-indigo-200"
              >
                Production (B{targetBatch?.number})
              </th>
            </tr>

            {/* Row 2: Sub-headers */}
            <tr>
              {/* Batch sub-headers */}
              {sortedBatches.map((b, idx) => {
                const theme = BATCH_THEMES[idx % BATCH_THEMES.length];
                return (
                  <React.Fragment key={b.id}>
                    <th
                      className={`num cursor-pointer select-none text-xs font-semibold py-1.5 px-2.5 ${theme.subHeader}`}
                      onClick={() => toggleSort(`b_${b.id}_pickup`)}
                      title={`Batch ${b.number} Pickup`}
                    >
                      <div className="inline-flex items-center gap-0.5 justify-end">
                        <span>Pickup</span>
                        <span className={`text-[9px] ${sortCol === `b_${b.id}_pickup` ? 'text-ink font-bold' : 'opacity-30'}`}>
                          {sortCol === `b_${b.id}_pickup` ? (sortAsc ? '▲' : '▼') : '↕'}
                        </span>
                      </div>
                    </th>
                    <th
                      className={`num cursor-pointer select-none text-xs font-semibold py-1.5 px-2.5 ${theme.subHeader}`}
                      onClick={() => toggleSort(`b_${b.id}_mail`)}
                      title={`Batch ${b.number} Mail`}
                    >
                      <div className="inline-flex items-center gap-0.5 justify-end">
                        <span>Mail</span>
                        <span className={`text-[9px] ${sortCol === `b_${b.id}_mail` ? 'text-ink font-bold' : 'opacity-30'}`}>
                          {sortCol === `b_${b.id}_mail` ? (sortAsc ? '▲' : '▼') : '↕'}
                        </span>
                      </div>
                    </th>
                    <th
                      className={`num cursor-pointer select-none text-xs font-bold py-1.5 px-2.5 border-r border-line/60 ${theme.subHeader}`}
                      onClick={() => toggleSort(`b_${b.id}_subtotal`)}
                      title={`Batch ${b.number} Subtotal`}
                    >
                      <div className="inline-flex items-center gap-0.5 justify-end">
                        <span>Subtotal</span>
                        <span className={`text-[9px] ${sortCol === `b_${b.id}_subtotal` ? 'text-ink font-bold' : 'opacity-30'}`}>
                          {sortCol === `b_${b.id}_subtotal` ? (sortAsc ? '▲' : '▼') : '↕'}
                        </span>
                      </div>
                    </th>
                  </React.Fragment>
                );
              })}

              {/* Event Demand sub-headers */}
              <th
                className="num cursor-pointer select-none text-xs font-semibold py-1.5 px-2.5 bg-slate-50 text-slate-800"
                onClick={() => toggleSort('totalPo')}
                title="Total Preorders across all batches"
              >
                <div className="inline-flex items-center gap-0.5 justify-end">
                  <span>Total PO</span>
                  <span className={`text-[9px] ${sortCol === 'totalPo' ? 'text-ink font-bold' : 'opacity-30'}`}>
                    {sortCol === 'totalPo' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>
              <th
                className="num cursor-pointer select-none text-xs font-semibold py-1.5 px-2.5 bg-slate-50 text-slate-800"
                onClick={() => toggleSort('onsite')}
                title="On-site extra units"
              >
                <div className="inline-flex items-center gap-0.5 justify-end">
                  <span>On-site</span>
                  <span className={`text-[9px] ${sortCol === 'onsite' ? 'text-ink font-bold' : 'opacity-30'}`}>
                    {sortCol === 'onsite' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>
              <th
                className="num cursor-pointer select-none text-xs font-bold py-1.5 px-2.5 bg-slate-100 text-slate-900 border-r border-slate-300"
                onClick={() => toggleSort('totalDemand')}
                title="Total Demand = Total PO + On-site"
              >
                <div className="inline-flex items-center gap-0.5 justify-end">
                  <span>Demand</span>
                  <span className={`text-[9px] ${sortCol === 'totalDemand' ? 'text-ink font-bold' : 'opacity-30'}`}>
                    {sortCol === 'totalDemand' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>

              {/* Stock Status sub-headers */}
              <th
                className="num cursor-pointer select-none text-xs font-semibold py-1.5 px-2.5 bg-stone-50 text-stone-800"
                onClick={() => toggleSort('onHand')}
                title="Units currently on hand in warehouse"
              >
                <div className="inline-flex items-center gap-0.5 justify-end">
                  <span>On hand</span>
                  <span className={`text-[9px] ${sortCol === 'onHand' ? 'text-ink font-bold' : 'opacity-30'}`}>
                    {sortCol === 'onHand' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>
              <th
                className="num cursor-pointer select-none text-xs font-semibold py-1.5 px-2.5 bg-stone-50 text-stone-800"
                onClick={() => toggleSort('committed')}
                title="Committed to all open orders"
              >
                <div className="inline-flex items-center gap-0.5 justify-end">
                  <span>Committed</span>
                  <span className={`text-[9px] ${sortCol === 'committed' ? 'text-ink font-bold' : 'opacity-30'}`}>
                    {sortCol === 'committed' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>
              <th
                className="num cursor-pointer select-none text-xs font-bold py-1.5 px-2.5 bg-stone-100 text-stone-900 border-r border-stone-300"
                onClick={() => toggleSort('available')}
                title="Available = On hand − Committed"
              >
                <div className="inline-flex items-center gap-0.5 justify-end">
                  <span>Available</span>
                  <span className={`text-[9px] ${sortCol === 'available' ? 'text-ink font-bold' : 'opacity-30'}`}>
                    {sortCol === 'available' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>

              {/* Production sub-headers */}
              <th
                className="num cursor-pointer select-none text-xs font-bold py-1.5 px-2.5 bg-indigo-50/80 text-indigo-950"
                onClick={() => toggleSort('net')}
                title="Net units required to order from supplier"
              >
                <div className="inline-flex items-center gap-0.5 justify-end">
                  <span>Net order</span>
                  <span className={`text-[9px] ${sortCol === 'net' ? 'text-ink font-bold' : 'opacity-30'}`}>
                    {sortCol === 'net' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>
              <th
                className="num cursor-pointer select-none text-xs font-semibold py-1.5 px-2.5 bg-indigo-50/80 text-indigo-950"
                onClick={() => toggleSort('ordered')}
                title={`Units ordered for Batch ${targetBatch?.number}`}
              >
                <div className="inline-flex items-center gap-0.5 justify-end">
                  <span>Ordered</span>
                  <span className={`text-[9px] ${sortCol === 'ordered' ? 'text-ink font-bold' : 'opacity-30'}`}>
                    {sortCol === 'ordered' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>
              <th
                className="num cursor-pointer select-none text-xs font-semibold py-1.5 px-2.5 bg-indigo-50/80 text-indigo-950"
                onClick={() => toggleSort('received')}
                title={`Units received for Batch ${targetBatch?.number}`}
              >
                <div className="inline-flex items-center gap-0.5 justify-end">
                  <span>Received</span>
                  <span className={`text-[9px] ${sortCol === 'received' ? 'text-ink font-bold' : 'opacity-30'}`}>
                    {sortCol === 'received' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => {
              const isGroupedByMgr = sortCol === 'manager';
              const first = lastMgr !== r.manager;
              lastMgr = r.manager;
              const isShort = r.netToOrder > 0;

              return (
                <React.Fragment key={r.key}>
                  {first && isGroupedByMgr && (
                    <tr className="group">
                      <td
                        colSpan={11 + sortedBatches.length * 3}
                        className="bg-cream-2 font-bold text-xs text-ink-2 py-1 px-3 border-y border-line"
                      >
                        {r.manager || 'Unassigned'}
                      </td>
                    </tr>
                  )}
                  <tr className="hover:bg-cream-2/40 transition-colors">
                    <td>
                      <div className="font-semibold">{r.label.item}</div>
                      {!isGroupedByMgr && r.manager && (
                        <div className="text-[11px] text-ink-2">Mgr: {r.manager}</div>
                      )}
                    </td>
                    <td className="text-sm">{r.label.variant || '—'}</td>

                    {/* Batch columns */}
                    {sortedBatches.map((b, idx) => {
                      const theme = BATCH_THEMES[idx % BATCH_THEMES.length];
                      const bData = r.batchData[b.id] ?? { pickup: 0, mail: 0, subtotal: 0 };
                      return (
                        <React.Fragment key={b.id}>
                          <td className={`num py-1.5 px-2.5 text-xs ${theme.pickupCell}`}>
                            {bData.pickup || '—'}
                          </td>
                          <td className={`num py-1.5 px-2.5 text-xs ${theme.mailCell}`}>
                            {bData.mail || '—'}
                          </td>
                          <td className={`num py-1.5 px-2.5 text-xs border-r border-line/50 ${theme.subtotalCell}`}>
                            {bData.subtotal}
                          </td>
                        </React.Fragment>
                      );
                    })}

                    {/* Event Demand columns */}
                    <td className="num font-semibold py-1.5 px-2.5 text-xs bg-slate-50/40">
                      {r.totalPreorder}
                    </td>
                    <td className="num py-1.5 px-2.5 text-xs bg-slate-50/40">
                      <NumberCell
                        value={r.onsiteExtra}
                        min={0}
                        onCommit={(v) => save(r.key, 'onsiteExtra', v)}
                        disabled={targetBatch?.mode === 'post'}
                      />
                    </td>
                    <td className="num font-bold py-1.5 px-2.5 text-xs bg-slate-100/50 border-r border-slate-300">
                      {r.totalDemand}
                    </td>

                    {/* Stock Status columns */}
                    <td className="num py-1.5 px-2.5 text-xs bg-stone-50/40">{r.onHand}</td>
                    <td className="num py-1.5 px-2.5 text-xs bg-stone-50/40">{r.committed}</td>
                    <td
                      className={`num font-semibold py-1.5 px-2.5 text-xs border-r border-stone-300 ${
                        r.available < 0 ? 'text-red-ink font-bold' : 'bg-stone-100/50'
                      }`}
                    >
                      {r.available}
                    </td>

                    {/* Production columns */}
                    <td className="num py-1.5 px-2.5 text-xs bg-indigo-50/30">
                      <div className="inline-flex items-center gap-1">
                        <span className="font-bold">{r.netToOrder}</span>
                        {isShort && <Pill tone="yellow">short</Pill>}
                      </div>
                    </td>
                    <td className="num py-1.5 px-2.5 text-xs bg-indigo-50/30">
                      <NumberCell
                        value={r.ordered}
                        min={0}
                        onCommit={(v) => save(r.key, 'ordered', v)}
                      />
                    </td>
                    <td className="num py-1.5 px-2.5 text-xs bg-indigo-50/30">
                      <NumberCell
                        value={r.received}
                        min={0}
                        onCommit={(v) => {
                          if ((v ?? 0) !== r.received) setPendingReceive({ row: r, value: v ?? 0 });
                        }}
                      />
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      <Confirm
        open={!!pendingReceive}
        onClose={() => setPendingReceive(null)}
        onConfirm={confirmReceive}
        title="Confirm received quantity"
        confirmLabel="Post to stock"
      >
        {pendingReceive && targetBatch && (
          <>
            Set received for <b>{pendingReceive.row.label.item}
            {pendingReceive.row.label.variant && ` · ${pendingReceive.row.label.variant}`}</b> in Batch {targetBatch.number} to <b>{pendingReceive.value}</b>. Stock changes by {pendingReceive.value - pendingReceive.row.received > 0 ? '+' : ''}{pendingReceive.value - pendingReceive.row.received}.
          </>
        )}
      </Confirm>
    </>
  );
}
