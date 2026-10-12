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
import { Empty, PageHeader, Pill, TableWrap } from '@/components/ui/Bits';
import { Modal } from '@/components/ui/Dialog';
import { QueryPage, useQuery } from '@/lib/useQuery';
import type { Item } from '@/types';

function CatalogList() {
  const { items, itemsById, staff, settings, movements, staffName } = useData();
  const { me } = useAuth();
  const { isMine } = usePrefs();
  const { run } = useToast();
  const { get, set } = useQuery();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showBundleModal, setShowBundleModal] = useState(false);

  // Bulk action states
  const [bulkAction, setBulkAction] = useState<'' | 'manager' | 'price' | 'category'>('');
  const [targetManagerId, setTargetManagerId] = useState('');
  const [targetCategory, setTargetCategory] = useState('');
  const [bulkPoPrice, setBulkPoPrice] = useState<string>('');
  const [bulkOtsPrice, setBulkOtsPrice] = useState<string>('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const type = get('type');
  const manager = get('manager');
  const categoryFilter = get('category');
  const active = get('active', 'active');

  const onHand = useMemo(() => onHandByKey(movements), [movements]);

  const bundles = useMemo(() => items.filter((i) => i.kind === 'bundle'), [items]);

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.category) s.add(i.category); });
    return [...s].sort();
  }, [items]);

  const rows = useMemo(() => items.filter((i) => {
    if (type && i.type !== type) return false;
    if (manager && i.managerId !== manager) return false;
    if (categoryFilter && i.category !== categoryFilter) return false;
    if (active === 'active' && !i.active) return false;
    if (active === 'inactive' && i.active) return false;
    if (!isMine(i)) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchName = i.name.toLowerCase().includes(q);
      const matchSku = (i.sku || '').toLowerCase().includes(q);
      const matchCategory = (i.category || '').toLowerCase().includes(q);
      const matchVariant = i.variants?.some((v) => v.name.toLowerCase().includes(q) || (v.sku || '').toLowerCase().includes(q));
      if (!matchName && !matchSku && !matchCategory && !matchVariant) return false;
    }
    return true;
  }), [items, type, manager, categoryFilter, active, isMine, search]);

  const stockOf = (item: Item, variantId?: string) => {
    if (item.kind !== 'product') return null;
    if (variantId) return onHand.get(variantKey(item.id, variantId)) ?? 0;
    return variantsOf(item).reduce((s, v) => s + (onHand.get(variantKey(item.id, v.id)) ?? 0), 0);
  };

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

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const resetFilters = () => {
    setSearch('');
    set({ type: '', manager: '', category: '', active: 'active' });
  };

  const hasActiveFilters = !!(type || manager || categoryFilter || (active && active !== 'active') || search);

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
            <Button variant="primary" href="/catalog/item/?new=product">New item</Button>
          </>
        }
      >
        {items.length} items, {bundles.length} bundles.
      </PageHeader>

      {/* Single-line compact multi-filter toolbar on widescreen */}
      <div className="mb-4 flex flex-wrap lg:flex-nowrap items-center gap-2 bg-white/95 p-2 rounded-xl border border-line shadow-xs">
        <Input
          placeholder="Search name, SKU, category, variant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <Select small value={type} onChange={(e) => set({ type: e.target.value })} className="w-auto min-w-[130px]">
          <option value="">All Types</option>
          {settings.itemTypes.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          <option value="bundle">Bundle</option>
        </Select>
        {allCategories.length > 0 && (
          <Select small value={categoryFilter} onChange={(e) => set({ category: e.target.value })} className="w-auto min-w-[130px]">
            <option value="">All Categories</option>
            {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}
        <Select small value={manager} onChange={(e) => set({ manager: e.target.value })} className="w-auto min-w-[140px]">
          <option value="">All Managers</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        </Select>
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
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>Type</th>
                <th>Manager</th>
                <th className="num">Price (PO / OTS)</th>
                <th className="num">Variants</th>
                <th className="num">On hand</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const stock = stockOf(i);
                const hasVariants = i.kind === 'product' && i.variants && i.variants.length > 0;
                const isExpanded = expandedIds.has(i.id);
                const isSelected = selectedIds.has(i.id);

                return (
                  <React.Fragment key={i.id}>
                    <tr
                      className={`clickable transition-colors ${isSelected ? 'bg-amber-50/60' : ''}`}
                      onClick={() => router.push(`/catalog/item/?id=${i.id}`)}
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
                          {hasVariants && (
                            <button
                              type="button"
                              onClick={(e) => toggleExpand(i.id, e)}
                              className="text-xs px-1.5 py-0.5 rounded border border-line bg-surface hover:bg-surface-2 transition-colors"
                              title="Toggle variants"
                            >
                              {isExpanded ? '▼' : '▶'}
                            </button>
                          )}
                          <span className="font-semibold">{i.name}</span>
                          {i.kind === 'bundle' && <Pill tone="blue">Bundle</Pill>}
                        </div>
                      </td>
                      <td>{i.category ? <Pill tone="blue">{i.category}</Pill> : <span className="text-ink-2">—</span>}</td>
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
                    </tr>

                    {/* Expandable nested variant sub-rows */}
                    {hasVariants && isExpanded && (
                      <tr className="bg-surface-2/30 border-b border-line">
                        <td colSpan={10} className="p-0 pl-12 pr-4 py-2">
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
            <Button variant="primary" onClick={() => { setShowBundleModal(false); router.push('/catalog/item/?new=bundle'); }}>
              + Create new bundle
            </Button>
            <Button onClick={() => setShowBundleModal(false)}>Close</Button>
          </div>
        }
      >
        {bundles.length === 0 ? (
          <Empty
            title="No bundles created yet"
            action={
              <Button variant="primary" onClick={() => { setShowBundleModal(false); router.push('/catalog/item/?new=bundle'); }}>
                Create your first bundle
              </Button>
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
                        {b.category && <Pill tone="blue">{b.category}</Pill>}
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
                      <Button size="sm" onClick={() => { setShowBundleModal(false); router.push(`/catalog/item/?id=${b.id}`); }}>
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
                          const vName = variantName(item, c.variantId);
                          const itemPrice = item?.price ?? 0;
                          return (
                            <div key={idx} className="flex justify-between items-center py-1 border-b border-line/40 last:border-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-ink-2 mono">{c.qty}x</span>
                                <span className="font-medium">{item?.name || 'Unknown item'}</span>
                                {vName && <span className="text-ink-2">({vName})</span>}
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
    </>
  );
}

export default function Page() {
  return <QueryPage><CatalogList /></QueryPage>;
}
