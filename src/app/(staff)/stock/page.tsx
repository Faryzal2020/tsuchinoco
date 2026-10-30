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
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Empty, PageHeader, Pill, Stat, TableWrap } from '@/components/ui/Bits';
import { Modal } from '@/components/ui/Dialog';
import { VariantSelect, useVariantLabel } from '@/components/VariantSelect';
import { QueryPage } from '@/lib/useQuery';
import { joinList, parseList, usePersistedFilters } from '@/lib/filterPrefs';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { NumberStepper } from '@/components/ui/Field';

function StockOverview() {
  const { items, itemsById, staff, movements, openOrders, settings, staffName } = useData();
  const { isMine } = usePrefs();
  const { me } = useAuth();
  const { run } = useToast();
  const { get, setFilters: set } = usePersistedFilters('tsu.filters.stock', ['type', 'manager', 'category', 'short']);
  const labelOf = useVariantLabel();
  const [search, setSearch] = useState('');
  const typeParam = get('type');
  const managerParam = get('manager');
  const categoryParam = get('category');
  const types = useMemo(() => parseList(typeParam), [typeParam]);
  const managers = useMemo(() => parseList(managerParam), [managerParam]);
  const categories = useMemo(() => parseList(categoryParam), [categoryParam]);
  const onlyShort = get('short') === '1';

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.category) s.add(i.category); });
    return [...s].sort();
  }, [items]);

  type StockSortCol = 'item' | 'variant' | 'manager' | 'onHand' | 'committed' | 'available';
  const [sortCol, setSortCol] = useState<StockSortCol>('item');
  const [sortAsc, setSortAsc] = useState(true);

  const toggleSort = (col: StockSortCol) => {
    if (sortCol === col) setSortAsc((prev) => !prev);
    else { setSortCol(col); setSortAsc(true); }
  };

  const rows = useMemo(() => {
    const list = stockRows(items, movements, openOrders).filter((r) => {
      const item = itemsById.get(r.itemId);
      if (types.length > 0 && !types.includes(item?.type ?? '')) return false;
      if (managers.length > 0 && !managers.includes(item?.managerId ?? '')) return false;
      if (categories.length > 0 && !categories.includes(item?.category ?? '')) return false;
      if (!isMine(item)) return false;
      if (onlyShort && r.available > 0) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const l = labelOf(r.itemId, r.variantId);
        const mgr = (staffName(item?.managerId ?? '') || '').toLowerCase();
        const cat = (item?.category ?? '').toLowerCase();
        const sku = (item?.sku ?? '').toLowerCase();
        const matchItem = l.item.toLowerCase().includes(q);
        const matchVar = l.variant.toLowerCase().includes(q);
        if (!matchItem && !matchVar && !mgr.includes(q) && !cat.includes(q) && !sku.includes(q)) return false;
      }

      return true;
    });

    return list.sort((a, b) => {
      let cmp = 0;
      const itemA = itemsById.get(a.itemId);
      const itemB = itemsById.get(b.itemId);
      const lA = labelOf(a.itemId, a.variantId);
      const lB = labelOf(b.itemId, b.variantId);

      switch (sortCol) {
        case 'item':
          cmp = lA.item.localeCompare(lB.item) || lA.variant.localeCompare(lB.variant);
          break;
        case 'variant':
          cmp = lA.variant.localeCompare(lB.variant);
          break;
        case 'manager': {
          const mA = staffName(itemA?.managerId ?? '');
          const mB = staffName(itemB?.managerId ?? '');
          cmp = mA.localeCompare(mB);
          break;
        }
        case 'onHand':
          cmp = a.onHand - b.onHand;
          break;
        case 'committed':
          cmp = a.committed - b.committed;
          break;
        case 'available':
          cmp = a.available - b.available;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [items, movements, openOrders, itemsById, types, managers, categories, isMine, onlyShort, search, sortCol, sortAsc, labelOf, staffName]);

  const hasActiveFilters = Boolean(search || types.length || managers.length || categories.length || onlyShort);

  const resetFilters = () => {
    setSearch('');
    set({ type: '', manager: '', category: '', short: null });
  };

  // Correction modal
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [qty, setQty] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const postCorrection = async () => {
    const n = Number(qty);
    if (!key || !Number.isFinite(n) || n === 0 || !note.trim()) return;
    setBusy(true);
    const { itemId, variantId } = splitKey(key);
    const ok = await run(() => movementRepo.create({ itemId, variantId, qty: Math.round(n), reason: 'correction', note: note.trim() }, me), 'Correction posted');
    setBusy(false);
    if (ok) { setOpen(false); setKey(''); setQty('0'); setNote(''); }
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
            <Button onClick={() => { setKey(''); setQty('0'); setNote(''); setOpen(true); }}>Add correction</Button>
            <Button variant="primary" href="/stock/take/">Stock take</Button>
          </>
        }
      >
        On hand is the ledger total. Committed is promised to open orders across every event. Available is what planning can use.
      </PageHeader>

      {/* Search & Filter Toolbar similar to Catalogue */}
      <div className="mb-4 flex flex-wrap lg:flex-nowrap items-center gap-2 bg-white/95 p-2 rounded-xl border border-line shadow-xs">
        <Input
          placeholder="Search item, variant, SKU, manager, category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <MultiSelect
          values={types}
          onChange={(v) => set({ type: joinList(v) })}
          options={settings.itemTypes.map((t) => ({ value: t, label: titleCase(t) }))}
          allLabel="All Types"
          noun="types"
          className="w-auto min-w-[130px]"
        />
        {allCategories.length > 0 && (
          <MultiSelect
            values={categories}
            onChange={(v) => set({ category: joinList(v) })}
            options={allCategories.map((c) => ({ value: c, label: c }))}
            allLabel="All Categories"
            noun="categories"
            className="w-auto min-w-[130px]"
          />
        )}
        <MultiSelect
          values={managers}
          onChange={(v) => set({ manager: joinList(v) })}
          options={staff.map((st) => ({ value: st.id, label: st.displayName }))}
          allLabel="All Managers"
          noun="managers"
          className="w-auto min-w-[140px]"
        />
        <Button size="sm" data-pressed={onlyShort ? 'true' : undefined} onClick={() => set({ short: onlyShort ? null : '1' })}>
          Short only
        </Button>
        {hasActiveFilters && (
          <Button size="sm" variant="quiet" onClick={resetFilters}>
            Reset
          </Button>
        )}
      </div>

      {rows.length === 0 ? <Empty title="No stock rows">Run a stock take to enter opening counts.</Empty> : (
        <TableWrap>
          <thead>
            <tr>
              <th className="cursor-pointer select-none hover:text-ink transition-colors" onClick={() => toggleSort('item')} title="Sort by Item">
                <div className="inline-flex items-center gap-1">
                  <span>Item</span>
                  <span className={`text-[10px] ${sortCol === 'item' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>{sortCol === 'item' ? (sortAsc ? '▲' : '▼') : '↕'}</span>
                </div>
              </th>
              <th className="cursor-pointer select-none hover:text-ink transition-colors" onClick={() => toggleSort('variant')} title="Sort by Variant">
                <div className="inline-flex items-center gap-1">
                  <span>Variant</span>
                  <span className={`text-[10px] ${sortCol === 'variant' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>{sortCol === 'variant' ? (sortAsc ? '▲' : '▼') : '↕'}</span>
                </div>
              </th>
              <th className="cursor-pointer select-none hover:text-ink transition-colors" onClick={() => toggleSort('manager')} title="Sort by Manager">
                <div className="inline-flex items-center gap-1">
                  <span>Manager</span>
                  <span className={`text-[10px] ${sortCol === 'manager' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>{sortCol === 'manager' ? (sortAsc ? '▲' : '▼') : '↕'}</span>
                </div>
              </th>
              <th className="num cursor-pointer select-none hover:text-ink transition-colors" onClick={() => toggleSort('onHand')} title="Sort by On hand">
                <div className="inline-flex items-center gap-1 justify-end">
                  <span>On hand</span>
                  <span className={`text-[10px] ${sortCol === 'onHand' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>{sortCol === 'onHand' ? (sortAsc ? '▲' : '▼') : '↕'}</span>
                </div>
              </th>
              <th className="num cursor-pointer select-none hover:text-ink transition-colors" onClick={() => toggleSort('committed')} title="Sort by Committed">
                <div className="inline-flex items-center gap-1 justify-end">
                  <span>Committed</span>
                  <span className={`text-[10px] ${sortCol === 'committed' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>{sortCol === 'committed' ? (sortAsc ? '▲' : '▼') : '↕'}</span>
                </div>
              </th>
              <th className="num cursor-pointer select-none hover:text-ink transition-colors" onClick={() => toggleSort('available')} title="Sort by Available">
                <div className="inline-flex items-center gap-1 justify-end">
                  <span>Available</span>
                  <span className={`text-[10px] ${sortCol === 'available' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>{sortCol === 'available' ? (sortAsc ? '▲' : '▼') : '↕'}</span>
                </div>
              </th>
              <th className="w-16 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const item = itemsById.get(r.itemId);
              const l = labelOf(r.itemId, r.variantId);
              const showItem = sortCol === 'item' ? (lastItem !== r.itemId) : true;
              lastItem = r.itemId;
              return (
                <tr key={r.key}>
                  <td className="font-semibold">{showItem ? l.item : ''}</td>
                  <td>{l.variant || '—'}</td>
                  <td className="text-ink-2">{showItem && item ? staffName(item.managerId) : ''}</td>
                  <td className="num">{r.onHand}</td>
                  <td className="num">{r.committed}</td>
                  <td className="num font-semibold">{r.available}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setKey(r.key);
                        setQty('0');
                        setNote('');
                        setOpen(true);
                      }}
                      title="Correct on-hand stock"
                      aria-label="Correct on-hand stock"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-line bg-white text-ink hover:bg-cream hover:border-line-strong shadow-xs transition-all cursor-pointer"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[15px] h-[15px] text-ink">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add stock correction"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={postCorrection} busy={busy} disabled={!key || !Number.isFinite(Number(qty)) || Math.round(Number(qty)) === 0 || !note.trim()}>Post correction</Button></>}>
        <div className="grid gap-3">
          <Field label="Variant"><VariantSelect value={key} onChange={setKey} /></Field>
          <Field label="Quantity change" hint="Positive adds stock, negative removes it."><NumberStepper value={qty} onChange={setQty} /></Field>
          <Field label="Reason note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. found a box in storage / damaged in transit" /></Field>
        </div>
      </Modal>
    </>
  );
}

export default function Page() {
  return <QueryPage><StockOverview /></QueryPage>;
}
