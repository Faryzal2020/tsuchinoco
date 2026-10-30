'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/prefs';
import { useToast } from '@/components/ui/Toast';
import { itemRepo } from '@/lib/repo';
import { formatMoney, titleCase } from '@/lib/format';
import { onHandByKey } from '@/lib/compute';
import { variantKey, variantsOf, variantPrice, variantOtsPrice, variantPriceJpy, variantName } from '@/lib/keys';
import { downloadCsv, toCsv } from '@/lib/csv';
import Button from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { CategoryPill, Empty, PageHeader, Pill, TableWrap } from '@/components/ui/Bits';
import { Confirm, Modal } from '@/components/ui/Dialog';
import { QueryPage } from '@/lib/useQuery';
import { joinList, parseList, usePersistedFilters } from '@/lib/filterPrefs';
import { MultiSelect } from '@/components/ui/MultiSelect';
import ItemEditorModal from '@/components/catalog/ItemEditorModal';
import BundleCsvImportModal from '@/components/catalog/BundleCsvImportModal';
import type { Item } from '@/types';

type SortCol = 'sku' | 'name' | 'category' | 'type' | 'manager' | 'price' | 'variants' | 'onHand' | 'status';

function CatalogList() {
  const { items, itemsById, staff, settings, movements, staffName } = useData();
  const { me } = useAuth();
  const { isMine, allowDelete } = usePrefs();
  const { run } = useToast();
  const { get, setFilters: set } = usePersistedFilters('tsu.filters.catalog', ['type', 'manager', 'category', 'active']);
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [showImportBundlesModal, setShowImportBundlesModal] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [newItemKind, setNewItemKind] = useState<'product' | 'bundle' | null>(null);

  // Sorting state
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // Bulk action states
  const [bulkAction, setBulkAction] = useState<'' | 'manager' | 'price' | 'category'>('');
  const [targetManagerId, setTargetManagerId] = useState('');
  const [targetCategory, setTargetCategory] = useState('');
  const [bulkPoPrice, setBulkPoPrice] = useState<string>('');
  const [bulkOtsPrice, setBulkOtsPrice] = useState<string>('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Clear catalogue states
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearBusy, setClearBusy] = useState(false);

  const typeParam = get('type');
  const managerParam = get('manager');
  const categoryParam = get('category');
  const types = useMemo(() => parseList(typeParam), [typeParam]);
  const managers = useMemo(() => parseList(managerParam), [managerParam]);
  const categories = useMemo(() => parseList(categoryParam), [categoryParam]);
  const active = get('active', 'active');
  const urlItemId = get('edit') || get('id');
  const urlNewKind = get('new') as 'product' | 'bundle' | '';

  React.useEffect(() => {
    if (urlItemId) {
      setEditingItemId(urlItemId);
    } else if (urlNewKind) {
      setNewItemKind(urlNewKind);
      setEditingItemId('new');
    }
  }, [urlItemId, urlNewKind]);

  const onHand = useMemo(() => onHandByKey(movements), [movements]);

  const bundles = useMemo(() => items.filter((i) => i.kind === 'bundle'), [items]);

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.category) s.add(i.category); });
    return [...s].sort();
  }, [items]);

  const rows = useMemo(() => items.filter((i) => {
    if (types.length > 0 && !types.includes(i.type)) return false;
    if (managers.length > 0 && !managers.includes(i.managerId)) return false;
    if (categories.length > 0 && !categories.includes(i.category ?? '')) return false;
    if (active === 'active' && !i.active) return false;
    if (active === 'inactive' && i.active) return false;
    if (!isMine(i)) return false;
    if (search) {
      const q = search.toLowerCase();
      const qDigits = q.replace(/[^\d]/g, '');
      const matchName = i.name.toLowerCase().includes(q);
      const matchSku = (i.sku || '').toLowerCase().includes(q);
      const matchCategory = (i.category || '').toLowerCase().includes(q);
      const matchVariant = i.variants?.some((v) => {
        const vName = v.name.toLowerCase().includes(q);
        const vSku = (v.sku || '').toLowerCase().includes(q);
        const vPo = v.price !== undefined && (v.price.toString().includes(q) || (qDigits && v.price.toString().includes(qDigits)));
        const vOts = v.otsPrice !== undefined && (v.otsPrice.toString().includes(q) || (qDigits && v.otsPrice.toString().includes(qDigits)));
        return vName || vSku || vPo || vOts;
      });
      // Manager search
      const mgr = (staffName(i.managerId) || i.managerName || '').toLowerCase();
      const matchManager = mgr.includes(q);
      // Price search
      const matchPrice =
        i.price.toString().includes(q) ||
        (qDigits && i.price.toString().includes(qDigits)) ||
        (i.otsPrice !== undefined && (i.otsPrice.toString().includes(q) || (qDigits && i.otsPrice.toString().includes(qDigits)))) ||
        (i.priceJpy !== undefined && (i.priceJpy.toString().includes(q) || (qDigits && i.priceJpy.toString().includes(qDigits))));

      if (!matchName && !matchSku && !matchCategory && !matchVariant && !matchManager && !matchPrice) return false;
    }
    return true;
  }), [items, types, managers, categories, active, isMine, search, staffName]);

  const stockOf = (item: Item, variantId?: string) => {
    if (item.kind !== 'product') return null;
    if (variantId) return onHand.get(variantKey(item.id, variantId)) ?? 0;
    return variantsOf(item).reduce((s, v) => s + (onHand.get(variantKey(item.id, v.id)) ?? 0), 0);
  };

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortAsc((prev) => !prev);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'sku':
          cmp = (a.sku || '').localeCompare(b.sku || '');
          break;
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'category':
          cmp = (a.category || '').localeCompare(b.category || '');
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'manager': {
          const mA = staffName(a.managerId) || a.managerName || '';
          const mB = staffName(b.managerId) || b.managerName || '';
          cmp = mA.localeCompare(mB);
          break;
        }
        case 'price':
          cmp = a.price - b.price;
          break;
        case 'variants': {
          const vA = a.kind === 'bundle' ? a.components.length : (a.variants?.length ?? 0);
          const vB = b.kind === 'bundle' ? b.components.length : (b.variants?.length ?? 0);
          cmp = vA - vB;
          break;
        }
        case 'onHand': {
          const sA = stockOf(a) ?? -999999;
          const sB = stockOf(b) ?? -999999;
          cmp = sA - sB;
          break;
        }
        case 'status':
          cmp = (a.active ? 1 : 0) - (b.active ? 1 : 0);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, sortCol, sortAsc, staffName, onHand]);

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(rows.map((r) => r.id)));
    else setSelectedIds(new Set());
  };

  const toggleSelect = (id: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const priceDisplay = (item: Item) => {
    if (item.variants && item.variants.length > 0) {
      const poPrices = item.variants.map((v) => variantPrice(item, v.id));
      const minPo = Math.min(...poPrices);
      const maxPo = Math.max(...poPrices);
      const poText = minPo === maxPo ? formatMoney(minPo, settings.currency) : `${minPo.toLocaleString()} – ${maxPo.toLocaleString()} ${settings.currency}`;

      const otsPrices = item.variants.map((v) => variantOtsPrice(item, v.id));
      const minOts = Math.min(...otsPrices);
      const maxOts = Math.max(...otsPrices);
      const hasDistinctOts = minOts !== minPo || maxOts !== maxPo;

      return (
        <div>
          <div>{poText}</div>
          {hasDistinctOts && (
            <div className="text-xs text-ink-2">
              OTS: {minOts === maxOts ? formatMoney(minOts, settings.currency) : `${minOts.toLocaleString()} – ${maxOts.toLocaleString()}`}
            </div>
          )}
          {item.priceJpy && <div className="text-xs text-blue-600 font-mono">¥{item.priceJpy.toLocaleString()}</div>}
        </div>
      );
    }

    return (
      <div>
        <div>{formatMoney(item.price, settings.currency)}</div>
        {item.otsPrice && item.otsPrice !== item.price && (
          <div className="text-xs text-ink-2">OTS: {formatMoney(item.otsPrice, settings.currency)}</div>
        )}
        {item.priceJpy && <div className="text-xs text-blue-600 font-mono">¥{item.priceJpy.toLocaleString()}</div>}
      </div>
    );
  };

  // Bulk operations
  const applyBulkManager = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    const ok = await run(
      () => itemRepo.bulkPatch([...selectedIds], { managerId: targetManagerId, managerName: undefined }, me),
      `Assigned manager for ${selectedIds.size} items`
    );
    setBulkBusy(false);
    if (ok) {
      setBulkAction('');
      setSelectedIds(new Set());
    }
  };

  const applyBulkCategory = async () => {
    if (selectedIds.size === 0 || !targetCategory.trim()) return;
    setBulkBusy(true);
    const ok = await run(
      () => itemRepo.bulkPatch([...selectedIds], { category: targetCategory.trim() }, me),
      `Updated category for ${selectedIds.size} items`
    );
    setBulkBusy(false);
    if (ok) {
      setBulkAction('');
      setSelectedIds(new Set());
    }
  };

  const applyBulkPrice = async () => {
    if (selectedIds.size === 0) return;
    const patch: Partial<Item> = {};
    if (bulkPoPrice !== '') patch.price = Number(bulkPoPrice);
    if (bulkOtsPrice !== '') patch.otsPrice = Number(bulkOtsPrice);
    if (Object.keys(patch).length === 0) return;

    setBulkBusy(true);
    const ok = await run(
      () => itemRepo.bulkPatch([...selectedIds], patch, me),
      `Updated price for ${selectedIds.size} items`
    );
    setBulkBusy(false);
    if (ok) {
      setBulkAction('');
      setSelectedIds(new Set());
    }
  };

  const applyBulkActive = async (activeState: boolean) => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    const ok = await run(
      () => itemRepo.bulkPatch([...selectedIds], { active: activeState }, me),
      `Set ${selectedIds.size} items to ${activeState ? 'Active' : 'Inactive'}`
    );
    setBulkBusy(false);
    if (ok) setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || !allowDelete) return;
    setBulkBusy(true);
    const ids = [...selectedIds];
    const ok = await run(
      () => itemRepo.bulkRemove(ids, me),
      `Deleted ${ids.length} item${ids.length > 1 ? 's' : ''}`
    );
    setBulkBusy(false);
    if (ok) {
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
    }
  };

  const handleClearCatalogue = async () => {
    if (!allowDelete || items.length === 0 || clearConfirmText.trim().toUpperCase() !== 'CLEAR') return;
    setClearBusy(true);
    const count = items.length;
    const ok = await run(
      () => itemRepo.clearAll(me),
      `Cleared all ${count} items from catalogue`
    );
    setClearBusy(false);
    if (ok) {
      setSelectedIds(new Set());
      setShowClearModal(false);
      setClearConfirmText('');
    }
  };

  const resetFilters = () => {
    setSearch('');
    set({ type: '', manager: '', category: '', active: 'active' });
  };

  const hasActiveFilters = !!(types.length || managers.length || categories.length || (active && active !== 'active') || search);

  const exportCsv = () => {
    downloadCsv('catalogue', toCsv(rows.map((i) => ({
      sku: i.sku ?? '',
      name: i.name,
      kind: i.kind,
      category: i.category ?? '',
      type: i.type,
      manager: staffName(i.managerId) || i.managerName || '',
      price: i.price,
      otsPrice: i.otsPrice ?? i.price,
      priceJpy: i.priceJpy ?? '',
      cost: i.cost ?? '',
      artist: i.artist ?? '',
      producedAt: i.producedAt,
      active: i.active ? 'yes' : 'no',
      variants: i.variants.map((v) => `${v.name}${v.sku ? `(${v.sku})` : ''}`).join('|'),
      components: i.components.map((c) => `${c.itemId}:${c.variantId}x${c.qty}`).join('|'),
      onHand: stockOf(i) ?? '',
      notes: i.notes,
    }))));
  };

  const isAllSelected = rows.length > 0 && selectedIds.size === rows.length;

  return (
    <>
      <PageHeader
        title="Catalogue"
        actions={
          <>
            <Button onClick={exportCsv}>Export CSV</Button>
            <Button href="/catalog/import/">Import CSV</Button>
            <Button onClick={() => setShowBundleModal(true)}>Bundles ({bundles.length})</Button>
            <Button
              variant="danger"
              disabled={!allowDelete || items.length === 0}
              title={!allowDelete ? 'Deletions disabled in Settings' : items.length === 0 ? 'Catalogue is already empty' : undefined}
              onClick={() => { setClearConfirmText(''); setShowClearModal(true); }}
            >
              Clear Catalogue
            </Button>
            <Button variant="primary" onClick={() => { setNewItemKind('product'); setEditingItemId('new'); }}>New item</Button>
          </>
        }
      >
        {items.length} items, {bundles.length} bundles.
      </PageHeader>

      {/* Single-line compact multi-filter toolbar on widescreen */}
      <div className="mb-4 flex flex-wrap lg:flex-nowrap items-center gap-2 bg-white/95 p-2 rounded-xl border border-line shadow-xs">
        <Input
          placeholder="Search name, SKU, category, manager, price…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <MultiSelect
          values={types}
          onChange={(v) => set({ type: joinList(v) })}
          options={[...settings.itemTypes.map((t) => ({ value: t, label: titleCase(t) })), { value: 'bundle', label: 'Bundle' }]}
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
        <Select small value={active} onChange={(e) => set({ active: e.target.value })} className="w-auto min-w-[110px]">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All Status</option>
        </Select>
        {hasActiveFilters && (
          <Button size="sm" variant="quiet" onClick={resetFilters} title="Reset all filters">
            Reset
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty title={items.length === 0 ? 'The catalogue is empty' : 'Nothing matches these filters'}
          action={items.length === 0 ? <Button href="/catalog/import/">Import from CSV</Button> : undefined}>
          {items.length === 0 && 'Import the catalogue sheet as CSV, or add items one by one.'}
        </Empty>
      ) : (
        <div className="relative pb-20">
          <TableWrap>
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    className="cursor-pointer rounded border-line"
                  />
                </th>
                <th
                  className="cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => toggleSort('sku')}
                  title="Sort by SKU"
                >
                  <div className="inline-flex items-center gap-1">
                    <span>SKU</span>
                    <span className={`text-[10px] ${sortCol === 'sku' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                      {sortCol === 'sku' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
                <th
                  className="cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => toggleSort('name')}
                  title="Sort by Name"
                >
                  <div className="inline-flex items-center gap-1">
                    <span>Name</span>
                    <span className={`text-[10px] ${sortCol === 'name' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                      {sortCol === 'name' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
                <th
                  className="cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => toggleSort('category')}
                  title="Sort by Category"
                >
                  <div className="inline-flex items-center gap-1">
                    <span>Category</span>
                    <span className={`text-[10px] ${sortCol === 'category' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                      {sortCol === 'category' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
                <th
                  className="cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => toggleSort('type')}
                  title="Sort by Type"
                >
                  <div className="inline-flex items-center gap-1">
                    <span>Type</span>
                    <span className={`text-[10px] ${sortCol === 'type' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                      {sortCol === 'type' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
                <th
                  className="cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => toggleSort('manager')}
                  title="Sort by Manager"
                >
                  <div className="inline-flex items-center gap-1">
                    <span>Manager</span>
                    <span className={`text-[10px] ${sortCol === 'manager' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                      {sortCol === 'manager' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
                <th
                  className="num cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => toggleSort('price')}
                  title="Sort by Price"
                >
                  <div className="inline-flex items-center gap-1 justify-end">
                    <span>Price (PO / OTS)</span>
                    <span className={`text-[10px] ${sortCol === 'price' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                      {sortCol === 'price' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
                <th
                  className="num cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => toggleSort('variants')}
                  title="Sort by Variants count"
                >
                  <div className="inline-flex items-center gap-1 justify-end">
                    <span>Variants</span>
                    <span className={`text-[10px] ${sortCol === 'variants' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                      {sortCol === 'variants' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
                <th
                  className="num cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => toggleSort('onHand')}
                  title="Sort by On Hand stock"
                >
                  <div className="inline-flex items-center gap-1 justify-end">
                    <span>On hand</span>
                    <span className={`text-[10px] ${sortCol === 'onHand' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                      {sortCol === 'onHand' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
                <th
                  className="cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => toggleSort('status')}
                  title="Sort by Status"
                >
                  <div className="inline-flex items-center gap-1">
                    <span>Status</span>
                    <span className={`text-[10px] ${sortCol === 'status' ? 'text-ink font-bold' : 'text-ink-2/30'}`}>
                      {sortCol === 'status' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
                <th className="w-16 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((i) => {
                const stock = stockOf(i);
                const hasVariants = i.kind === 'product' && i.variants && i.variants.length > 0;
                const isExpanded = expandedIds.has(i.id);
                const isSelected = selectedIds.has(i.id);

                return (
                  <React.Fragment key={i.id}>
                    <tr
                      className={`transition-colors ${hasVariants ? 'cursor-pointer hover:bg-surface-2/40' : ''} ${isSelected ? 'bg-amber-50/60' : ''}`}
                      onClick={() => {
                        if (hasVariants) toggleExpand(i.id);
                      }}
                    >
                      <td className="w-10" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleSelect(i.id, e)}
                          className="cursor-pointer rounded border-line"
                        />
                      </td>
                      <td className="mono text-xs text-ink-2">{i.sku || '—'}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{i.name}</span>
                          {i.kind === 'bundle' && <Pill tone="blue">Bundle</Pill>}
                        </div>
                      </td>
                      <td>{i.category ? <CategoryPill category={i.category} /> : <span className="text-ink-2">—</span>}</td>
                      <td>{titleCase(i.type)}</td>
                      <td>
                        {i.managerId ? (
                          staffName(i.managerId)
                        ) : i.managerName ? (
                          <Pill tone="yellow">Unassigned ({i.managerName})</Pill>
                        ) : (
                          <span className="text-ink-2">—</span>
                        )}
                      </td>
                      <td className="num">{priceDisplay(i)}</td>
                      <td className="num">
                        {i.kind === 'bundle'
                          ? `${i.components.length} parts`
                          : hasVariants
                          ? `${i.variants.length} vars`
                          : '—'}
                      </td>
                      <td className="num font-semibold">{stock === null ? '—' : stock}</td>
                      <td>{i.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setEditingItemId(i.id)}
                          title="Edit item"
                          aria-label="Edit item"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-line bg-white text-ink hover:bg-cream hover:border-line-strong shadow-xs transition-all cursor-pointer"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[15px] h-[15px] text-ink">
                            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                            <path d="m15 5 4 4" />
                          </svg>
                        </button>
                      </td>
                    </tr>

                    {/* Expandable nested variant sub-rows */}
                    {hasVariants && isExpanded && (
                      <tr className="bg-surface-2/30 border-b border-line">
                        <td colSpan={11} className="p-0 pl-12 pr-4 py-2">
                          <div className="rounded border border-line bg-white/80 p-2.5 my-1 text-sm">
                            <div className="text-xs font-bold text-ink-2 uppercase tracking-wider mb-2">
                              {i.name} — {i.variants.length} Variants
                            </div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-line text-ink-2 text-left">
                                  <th className="py-1">Variant Name</th>
                                  <th className="py-1">Variant SKU</th>
                                  <th className="py-1 num">PO Price</th>
                                  <th className="py-1 num">OTS Price</th>
                                  <th className="py-1 num">JPY Price</th>
                                  <th className="py-1 num">On Hand</th>
                                  <th className="py-1">Status</th>
                                  <th className="py-1 text-right w-16">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {i.variants.map((v) => {
                                  const vPo = variantPrice(i, v.id);
                                  const vOts = variantOtsPrice(i, v.id);
                                  const vJpy = variantPriceJpy(i, v.id);
                                  const vStock = stockOf(i, v.id);
                                  const isPoOverridden = typeof v.price === 'number';
                                  const isOtsOverridden = typeof v.otsPrice === 'number';

                                  return (
                                    <tr key={v.id} className="border-b border-line/40 last:border-0 hover:bg-surface-2/20">
                                      <td className="py-1.5 font-medium">{v.name}</td>
                                      <td className="py-1.5 mono text-ink-2">{v.sku || '—'}</td>
                                      <td className="py-1.5 num">
                                        <span className={isPoOverridden ? 'font-bold text-blue-700' : ''}>
                                          {formatMoney(vPo, settings.currency)}
                                        </span>
                                      </td>
                                      <td className="py-1.5 num">
                                        <span className={isOtsOverridden ? 'font-bold text-purple-700' : ''}>
                                          {formatMoney(vOts, settings.currency)}
                                        </span>
                                      </td>
                                      <td className="py-1.5 num mono text-blue-600">
                                        {vJpy ? `¥${vJpy.toLocaleString()}` : '—'}
                                      </td>
                                      <td className="py-1.5 num font-semibold">{vStock}</td>
                                      <td className="py-1.5">
                                        {v.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}
                                      </td>
                                      <td className="py-1.5 text-right">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingItemId(i.id);
                                          }}
                                          title={`Edit ${v.name}`}
                                          aria-label={`Edit ${v.name}`}
                                          className="inline-flex items-center justify-center w-7 h-7 rounded border border-line bg-white text-ink hover:bg-cream hover:border-line-strong shadow-xs transition-all cursor-pointer"
                                        >
                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink">
                                            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                            <path d="m15 5 4 4" />
                                          </svg>
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </TableWrap>

          {/* Floating Bulk Action Bar */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-ink text-surface px-5 py-3 rounded-xl shadow-2xl flex flex-wrap items-center gap-3 border border-ink-2/30 max-w-[95vw]">
              <span className="font-bold text-sm bg-yellow text-ink px-2 py-0.5 rounded-full">
                {selectedIds.size} selected
              </span>

              {bulkAction === '' && (
                <>
                  <Button size="sm" onClick={() => setBulkAction('manager')}>Assign Manager</Button>
                  <Button size="sm" onClick={() => setBulkAction('price')}>Change Price</Button>
                  <Button size="sm" onClick={() => setBulkAction('category')}>Set Category</Button>
                  <Button size="sm" onClick={() => applyBulkActive(true)} busy={bulkBusy}>Mark Active</Button>
                  <Button size="sm" onClick={() => applyBulkActive(false)} busy={bulkBusy}>Mark Inactive</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!allowDelete || bulkBusy}
                    title={!allowDelete ? 'Deletions disabled in Settings' : undefined}
                    onClick={() => setConfirmBulkDelete(true)}
                  >
                    Delete Selected
                  </Button>
                  <Button size="sm" variant="quiet" className="text-surface-2 hover:text-white" onClick={() => setSelectedIds(new Set())}>Deselect</Button>
                </>
              )}

              {bulkAction === 'manager' && (
                <div className="flex items-center gap-2">
                  <Select small value={targetManagerId} onChange={(e) => setTargetManagerId(e.target.value)} className="w-[180px] text-ink">
                    <option value="">Choose manager…</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                  </Select>
                  <Button size="sm" variant="primary" disabled={!targetManagerId} busy={bulkBusy} onClick={applyBulkManager}>Apply</Button>
                  <Button size="sm" variant="quiet" onClick={() => setBulkAction('')}>Cancel</Button>
                </div>
              )}

              {bulkAction === 'price' && (
                <div className="flex items-center gap-2">
                  <Input small type="number" min={0} placeholder="PO Price" value={bulkPoPrice} onChange={(e) => setBulkPoPrice(e.target.value)} className="w-[110px] text-ink" />
                  <Input small type="number" min={0} placeholder="OTS Price" value={bulkOtsPrice} onChange={(e) => setBulkOtsPrice(e.target.value)} className="w-[110px] text-ink" />
                  <Button size="sm" variant="primary" disabled={bulkPoPrice === '' && bulkOtsPrice === ''} busy={bulkBusy} onClick={applyBulkPrice}>Apply</Button>
                  <Button size="sm" variant="quiet" onClick={() => setBulkAction('')}>Cancel</Button>
                </div>
              )}

              {bulkAction === 'category' && (
                <div className="flex items-center gap-2">
                  <Input small placeholder="Category name…" value={targetCategory} onChange={(e) => setTargetCategory(e.target.value)} className="w-[150px] text-ink" />
                  <Button size="sm" variant="primary" disabled={!targetCategory.trim()} busy={bulkBusy} onClick={applyBulkCategory}>Apply</Button>
                  <Button size="sm" variant="quiet" onClick={() => setBulkAction('')}>Cancel</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bundles Modal */}
      <Modal
        open={showBundleModal}
        onClose={() => setShowBundleModal(false)}
        title={`Catalogue Bundles (${bundles.length})`}
        wide
        footer={
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={() => { setShowBundleModal(false); setNewItemKind('bundle'); setEditingItemId('new'); }}>
                + Create new bundle
              </Button>
              <Button onClick={() => setShowImportBundlesModal(true)}>
                Import from CSV
              </Button>
            </div>
            <Button onClick={() => setShowBundleModal(false)}>Close</Button>
          </div>
        }
      >
        {bundles.length === 0 ? (
          <Empty
            title="No bundles created yet"
            action={
              <div className="flex items-center gap-2">
                <Button variant="primary" onClick={() => { setShowBundleModal(false); setNewItemKind('bundle'); setEditingItemId('new'); }}>
                  Create your first bundle
                </Button>
                <Button onClick={() => setShowImportBundlesModal(true)}>
                  Import from CSV
                </Button>
              </div>
            }
          >
            Bundles combine multiple product variants into a discounted package with automatic stock deduction and revenue allocation.
          </Empty>
        ) : (
          <div className="grid gap-4">
            {bundles.map((b) => {
              const listTotal = b.components.reduce((sum, c) => {
                const it = itemsById.get(c.itemId);
                return sum + c.qty * (it?.price ?? 0);
              }, 0);
              const savings = listTotal - b.price;

              return (
                <div key={b.id} className="rounded-xl border border-line p-4 bg-white shadow-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base">{b.name}</span>
                        {b.sku && <span className="mono text-xs text-ink-2">[{b.sku}]</span>}
                        {b.category && <CategoryPill category={b.category} />}
                        {!b.active && <Pill tone="neutral">Inactive</Pill>}
                      </div>
                      <div className="text-xs text-ink-2 mt-0.5">
                        Manager: {staffName(b.managerId) || b.managerName || '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-bold text-base">{formatMoney(b.price, settings.currency)}</div>
                        {b.otsPrice && b.otsPrice !== b.price && (
                          <div className="text-xs text-ink-2">OTS: {formatMoney(b.otsPrice, settings.currency)}</div>
                        )}
                        {savings > 0 && (
                          <div className="text-xs text-green-700 font-semibold">
                            Save {formatMoney(savings, settings.currency)}
                          </div>
                        )}
                      </div>
                      <Button size="sm" onClick={() => { setShowBundleModal(false); setEditingItemId(b.id); }}>
                        Edit
                      </Button>
                    </div>
                  </div>

                  {/* Bundle components breakdown */}
                  <div className="rounded-lg bg-surface-2/40 p-2.5">
                    <div className="text-xs font-bold text-ink-2 mb-2 uppercase tracking-wider">
                      Included Items ({b.components.length} components)
                    </div>
                    {b.components.length === 0 ? (
                      <p className="text-xs text-ink-2 italic">No components configured yet.</p>
                    ) : (
                      <div className="grid gap-1.5 text-xs">
                        {b.components.map((c, idx) => {
                          const item = itemsById.get(c.itemId);
                          const isChoice = !c.variantId && c.allowedVariantIds && c.allowedVariantIds.length > 0;
                          const allowedNames = isChoice
                            ? item?.variants.filter((v) => c.allowedVariantIds!.includes(v.id)).map((v) => v.name)
                            : [];
                          const vName = variantName(item, c.variantId || '');
                          const itemPrice = item?.price ?? 0;
                          return (
                            <div key={idx} className="flex justify-between items-center py-1 border-b border-line/40 last:border-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-ink-2 mono">{c.qty}x</span>
                                <span className="font-medium">{item?.name || 'Unknown item'}</span>
                                {isChoice ? (
                                  <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                                    Choice: {allowedNames && allowedNames.length > 0 ? allowedNames.join(', ') : 'Any Variant'}
                                  </span>
                                ) : vName ? (
                                  <span className="text-ink-2">({vName})</span>
                                ) : null}
                              </div>
                              <div className="text-ink-2">
                                {c.allocatedPrice !== undefined ? (
                                   <span>Allocated: {formatMoney(c.allocatedPrice, settings.currency)}</span>
                                ) : (
                                   <span>List: {formatMoney(itemPrice * c.qty, settings.currency)}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <BundleCsvImportModal
        open={showImportBundlesModal}
        onClose={() => setShowImportBundlesModal(false)}
      />

      <ItemEditorModal
        open={!!editingItemId}
        itemId={editingItemId === 'new' ? null : editingItemId}
        newKind={newItemKind}
        onClose={() => {
          setEditingItemId(null);
          setNewItemKind(null);
          if (urlItemId || urlNewKind) {
            set({ edit: null, id: null, new: null });
          }
        }}
      />

      {/* Bulk Delete Confirm Modal */}
      <Confirm
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedIds.size} selected item${selectedIds.size > 1 ? 's' : ''}?`}
        confirmLabel="Delete permanently"
        danger
        busy={bulkBusy}
      >
        <p className="mb-2">Are you sure you want to permanently remove these <strong>{selectedIds.size}</strong> selected items from the catalogue?</p>
        <p className="text-xs text-ink-2">This action is irreversible and will be logged in the immutable system audit log.</p>
      </Confirm>

      {/* Clear Catalogue Modal */}
      <Modal
        open={showClearModal}
        onClose={() => { setShowClearModal(false); setClearConfirmText(''); }}
        title="Clear Entire Catalogue"
        footer={
          <div className="flex w-full items-center justify-between">
            <Button onClick={() => { setShowClearModal(false); setClearConfirmText(''); }}>Cancel</Button>
            <Button
              variant="danger"
              disabled={clearConfirmText.trim().toUpperCase() !== 'CLEAR' || !allowDelete}
              busy={clearBusy}
              onClick={handleClearCatalogue}
            >
              Wipe Catalogue ({items.length} items)
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="p-3 bg-red-soft text-red-ink rounded-lg text-sm border border-red-300">
            <p className="font-bold">⚠️ Warning: High-impact destructive action</p>
            <p className="mt-1">
              This will permanently delete <strong>all {items.length} items</strong> (both products and bundles) from the catalogue. This cannot be undone.
            </p>
          </div>
          <p className="text-sm text-ink-2">
            To confirm this action, please type <strong className="font-mono text-ink">CLEAR</strong> in the field below:
          </p>
          <Input
            value={clearConfirmText}
            onChange={(e) => setClearConfirmText(e.target.value)}
            placeholder="Type CLEAR to confirm"
            autoFocus
          />
        </div>
      </Modal>
    </>
  );
}

export default function Page() {
  return <QueryPage><CatalogList /></QueryPage>;
}
