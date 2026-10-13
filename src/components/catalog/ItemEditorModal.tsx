'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/prefs';
import { useToast } from '@/components/ui/Toast';
import { itemRepo } from '@/lib/repo';
import { allocateBundlePrice } from '@/lib/bundle';
import { stockRows } from '@/lib/compute';
import { newId, splitKey, variantKey } from '@/lib/keys';
import { formatDateTime, formatMoney, titleCase } from '@/lib/format';
import type { BundleComponent, Item, Variant } from '@/types';
import Button from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Kv, Panel, Pill, StatusPill, TableWrap } from '@/components/ui/Bits';
import { Confirm, Modal } from '@/components/ui/Dialog';
import { VariantSelect, useVariantLabel } from '@/components/VariantSelect';
import ThumbnailInput from '@/components/form/ThumbnailInput';
import CategoryInput from './CategoryInput';

type Draft = Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>;

const blank = (kind: 'product' | 'bundle', type: string, managerId: string): Draft => ({
  name: '',
  sku: '',
  category: '',
  artist: '',
  kind,
  type: kind === 'bundle' ? 'bundle' : type,
  managerId,
  price: 0,
  otsPrice: undefined,
  priceJpy: undefined,
  producedAt: '',
  active: true,
  variants: [],
  components: [],
  notes: '',
});

interface ItemEditorModalProps {
  itemId?: string | null;
  newKind?: 'product' | 'bundle' | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (item: Item) => void;
}

export default function ItemEditorModal({
  itemId,
  newKind,
  open,
  onClose,
  onSaved,
}: ItemEditorModalProps) {
  const { items, itemsById, staff, settings, movements, openOrders, events, staffName } = useData();
  const { me } = useAuth();
  const { allowDelete } = usePrefs();
  const { run } = useToast();

  const existing = itemId ? itemsById.get(itemId) : undefined;
  const isNew = !itemId;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<'details' | 'variants' | 'history'>('details');

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => {
      if (i.category && i.category.trim()) s.add(i.category.trim());
    });
    return [...s].sort();
  }, [items]);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setTab('details');
      return;
    }
    if (existing) {
      const { id: _id, createdAt: _c, updatedAt: _u, updatedBy: _b, ...rest } = existing;
      void _id; void _c; void _u; void _b;
      setDraft({
        ...rest,
        sku: rest.sku ?? '',
        category: rest.category ?? '',
        artist: rest.artist ?? '',
        otsPrice: rest.otsPrice,
        priceJpy: rest.priceJpy,
        variants: rest.variants ?? [],
        components: rest.components ?? [],
        notes: rest.notes ?? '',
        producedAt: rest.producedAt ?? '',
      });
    } else if (isNew) {
      setDraft(blank(newKind === 'bundle' ? 'bundle' : 'product', settings.itemTypes[0] ?? 'other', me));
    }
  }, [existing, isNew, newKind, settings.itemTypes, me, open]);

  const labelOf = useVariantLabel();

  const stock = useMemo(() => (itemId ? stockRows(items, movements, openOrders).filter((r) => r.itemId === itemId) : []), [items, movements, openOrders, itemId]);
  const history = useMemo(() => (itemId ? movements.filter((m) => m.itemId === itemId).slice(0, 50) : []), [movements, itemId]);
  const soldPerEvent = useMemo(() => {
    if (!itemId) return [];
    const m = new Map<string, number>();
    for (const mv of movements) {
      if (mv.itemId !== itemId || !mv.eventId) continue;
      if (mv.reason === 'pickup' || mv.reason === 'walkin' || mv.reason === 'shipped') {
        m.set(mv.eventId, (m.get(mv.eventId) ?? 0) - mv.qty);
      }
    }
    return [...m.entries()].map(([eventId, sold]) => ({
      eventId,
      sold,
      name: events.find((e) => e.id === eventId)?.name ?? eventId,
    }));
  }, [movements, itemId, events]);

  const referenced = useMemo(() => {
    if (!itemId) return false;
    if (movements.some((m) => m.itemId === itemId)) return true;
    if (openOrders.some((o) => o.lines.some((l) => l.itemId === itemId) || o.rawLines.some((l) => l.itemId === itemId))) return true;
    if (items.some((i) => i.components.some((c) => c.itemId === itemId))) return true;
    return false;
  }, [itemId, movements, openOrders, items]);

  if (!open || !draft) return null;

  const up = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const isBundle = draft.kind === 'bundle';

  const valid = draft.name.trim().length > 0 && draft.price >= 0 &&
    (!isBundle || (draft.components.length > 0 && draft.components.every((c) => c.itemId && c.variantId && c.qty > 0)));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const data: Draft = {
      ...draft,
      name: draft.name.trim(),
      sku: draft.sku?.trim() || undefined,
      category: draft.category?.trim() || undefined,
      artist: draft.artist?.trim() || undefined,
      variants: isBundle
        ? []
        : draft.variants.filter((v) => v.name.trim()).map((v) => ({
            ...v,
            name: v.name.trim(),
            sku: v.sku?.trim() || undefined,
          })),
      components: isBundle ? draft.components : [],
    };
    if (data.cost === undefined || Number.isNaN(data.cost)) delete data.cost;
    if (data.otsPrice === undefined || Number.isNaN(data.otsPrice)) delete data.otsPrice;
    if (data.priceJpy === undefined || Number.isNaN(data.priceJpy)) delete data.priceJpy;

    let savedItem: Item | null = null;
    const ok = await run(async () => {
      if (itemId) {
        await itemRepo.patch(itemId, data, me);
        savedItem = { id: itemId, ...data, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(), updatedBy: me };
      } else {
        const newIdv = await itemRepo.create(data, me);
        savedItem = { id: newIdv, ...data, createdAt: Date.now(), updatedAt: Date.now(), updatedBy: me };
      }
    }, 'Saved');
    setSaving(false);
    if (ok) {
      if (savedItem && onSaved) onSaved(savedItem);
      onClose();
    }
  };

  const remove = async () => {
    if (!itemId) return;
    const ok = await run(() => itemRepo.remove(itemId), 'Deleted');
    if (ok) onClose();
  };

  // Bundle preview split
  const alloc = isBundle ? allocateBundlePrice({ price: draft.price, components: draft.components }, itemsById) : new Map<string, number>();
  const listTotal = isBundle ? draft.components.reduce((s, c) => s + c.qty * (itemsById.get(c.itemId)?.price ?? 0), 0) : 0;

  const titleText = isNew
    ? (isBundle ? 'New bundle' : 'New item')
    : existing ? existing.name : 'Edit item';

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        wide
        title={titleText}
        footer={
          <div className="flex w-full items-center justify-between">
            <div>
              {!isNew && (
                referenced ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => up({ active: !draft.active })}
                  >
                    {draft.active ? 'Mark inactive' : 'Mark active'}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirmDelete(true)}
                    disabled={!allowDelete}
                    title={!allowDelete ? 'Deletions disabled in Settings' : undefined}
                  >
                    Delete
                  </Button>
                )
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={save} busy={saving} disabled={!valid}>
                Save
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Subheader tabs */}
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTab('details')}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${tab === 'details' ? 'bg-yellow-soft text-yellow-ink border border-yellow-2' : 'hover:bg-surface-2 text-ink-2'}`}
              >
                Item Details
              </button>
              {!isBundle && (
                <button
                  type="button"
                  onClick={() => setTab('variants')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${tab === 'variants' ? 'bg-yellow-soft text-yellow-ink border border-yellow-2' : 'hover:bg-surface-2 text-ink-2'}`}
                >
                  Variants
                  {draft.variants.length > 0 && (
                    <span className="pill pill-blue text-[10px] px-1.5 h-4">{draft.variants.length}</span>
                  )}
                </button>
              )}
              {isBundle && (
                <button
                  type="button"
                  onClick={() => setTab('variants')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${tab === 'variants' ? 'bg-yellow-soft text-yellow-ink border border-yellow-2' : 'hover:bg-surface-2 text-ink-2'}`}
                >
                  Bundle Components
                  <span className="pill pill-blue text-[10px] px-1.5 h-4">{draft.components.length}</span>
                </button>
              )}
              {!isNew && (
                <button
                  type="button"
                  onClick={() => setTab('history')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${tab === 'history' ? 'bg-yellow-soft text-yellow-ink border border-yellow-2' : 'hover:bg-surface-2 text-ink-2'}`}
                >
                  Stock & Sales
                </button>
              )}
            </div>
            {!isNew && existing && (
              <span className="hint text-[11px]">
                Updated {formatDateTime(existing.updatedAt)} by {staffName(existing.updatedBy)}
              </span>
            )}
          </div>

          {/* TAB 1: DETAILS */}
          {tab === 'details' && (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2">
                <Input value={draft.name} onChange={(e) => up({ name: e.target.value })} autoFocus={isNew} placeholder="Product title" />
              </Field>

              <Field label="Final ID / SKU" hint="e.g. J_AK_UMA_GIGI">
                <Input value={draft.sku ?? ''} onChange={(e) => up({ sku: e.target.value })} placeholder="J_AK_UMA_" />
              </Field>

              <Field label="Category / Fandom" hint="Search or type new category">
                <CategoryInput
                  value={draft.category ?? ''}
                  onChange={(cat) => up({ category: cat })}
                  existingCategories={allCategories}
                  placeholder="e.g. HOLOUMA, HOLOMILK"
                />
              </Field>

              {!isBundle && (
                <Field label="Type">
                  <Select value={draft.type} onChange={(e) => up({ type: e.target.value })}>
                    {settings.itemTypes.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
                    {!settings.itemTypes.includes(draft.type) && <option value={draft.type}>{titleCase(draft.type)}</option>}
                  </Select>
                </Field>
              )}

              <Field label="Product manager">
                <Select value={draft.managerId} onChange={(e) => up({ managerId: e.target.value })}>
                  <option value="">{draft.managerName ? `Unassigned (${draft.managerName})` : 'Unassigned'}</option>
                  {staff.filter((s) => s.active || s.id === draft.managerId).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                </Select>
              </Field>

              <Field label="Artist / Credit" hint="Illustrator credit">
                <Input value={draft.artist ?? ''} onChange={(e) => up({ artist: e.target.value })} placeholder="jknor719" />
              </Field>

              <Field label={`Pre-Order Price (${settings.currency})`}>
                <Input type="number" min={0} value={draft.price} onChange={(e) => up({ price: Number(e.target.value) })} />
              </Field>

              <Field label={`On-The-Spot Price (${settings.currency})`} hint="Walk-in price (blank = same as PO)">
                <Input type="number" min={0} placeholder={draft.price ? `${draft.price}` : ''} value={draft.otsPrice ?? ''} onChange={(e) => up({ otsPrice: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </Field>

              <Field label="C107 / JPY Price (¥), optional" hint="Japan / foreign event price">
                <Input type="number" min={0} placeholder="e.g. 500" value={draft.priceJpy ?? ''} onChange={(e) => up({ priceJpy: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </Field>

              <Field label={`Unit cost (${settings.currency}), optional`} hint="Used for margin on reports">
                <Input type="number" min={0} value={draft.cost ?? ''} onChange={(e) => up({ cost: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </Field>

              {!isBundle && (
                <Field label="Produced at" hint="Where this is made" className="sm:col-span-2">
                  <Input value={draft.producedAt} onChange={(e) => up({ producedAt: e.target.value })} />
                </Field>
              )}

              <Field label="Notes" className="sm:col-span-2">
                <Textarea value={draft.notes} onChange={(e) => up({ notes: e.target.value })} rows={2} />
              </Field>

              <div className="sm:col-span-2">
                <span className="label">Thumbnail</span>
                <ThumbnailInput value={draft.thumbnailId} onChange={(thumbnailId) => up({ thumbnailId })} />
                <span className="hint mt-1 block">Shown next to this item on the preorder form.</span>
              </div>

              <div className="sm:col-span-2">
                <Checkbox label="Active (offered in new batches)" checked={draft.active} onChange={(e) => up({ active: e.target.checked })} />
              </div>
            </div>
          )}

          {/* TAB 2: VARIANTS OR BUNDLE COMPONENTS */}
          {tab === 'variants' && !isBundle && (
            <VariantsEditorModalSection
              variants={draft.variants}
              defaultPrice={draft.price}
              defaultOtsPrice={draft.otsPrice}
              onChange={(variants) => up({ variants })}
              usedIds={new Set(stock.filter((r) => r.onHand !== 0 || r.committed !== 0).map((r) => r.variantId))}
            />
          )}

          {tab === 'variants' && isBundle && (
            <div>
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="font-bold text-sm">Bundle Components</h3>
                <span className="hint text-xs">
                  List total {formatMoney(listTotal, settings.currency)} · Bundle {formatMoney(draft.price, settings.currency)}
                </span>
              </div>
              <div className="grid gap-2">
                {draft.components.map((c, idx) => {
                  const key = c.itemId ? variantKey(c.itemId, c.variantId) : '';
                  const proposed = alloc.get(key);
                  return (
                    <div key={idx} className="grid grid-cols-[minmax(0,1fr)_70px_120px_auto] items-center gap-2">
                      <VariantSelect
                        small
                        value={key}
                        excludeItemId={itemId || undefined}
                        onChange={(k) => {
                          const next = [...draft.components];
                          const { itemId: itmId, variantId } = k ? splitKey(k) : { itemId: '', variantId: '' };
                          next[idx] = { ...c, itemId: itmId, variantId };
                          up({ components: next });
                        }}
                      />
                      <Input
                        small
                        type="number"
                        min={1}
                        value={c.qty}
                        title="Quantity"
                        onChange={(e) => {
                          const next = [...draft.components];
                          next[idx] = { ...c, qty: Number(e.target.value) };
                          up({ components: next });
                        }}
                      />
                      <Input
                        small
                        type="number"
                        min={0}
                        placeholder={proposed !== undefined ? `${proposed}` : 'auto'}
                        value={c.allocatedPrice ?? ''}
                        title="Allocated unit price"
                        onChange={(e) => {
                          const next = [...draft.components];
                          const v = e.target.value;
                          next[idx] = { ...c, allocatedPrice: v === '' ? undefined : Number(v) };
                          if (v === '') delete next[idx].allocatedPrice;
                          up({ components: next });
                        }}
                      />
                      <Button size="sm" variant="quiet" onClick={() => up({ components: draft.components.filter((_, i) => i !== idx) })}>
                        Remove
                      </Button>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[minmax(0,1fr)_70px_120px_auto] gap-2 hint px-1 text-xs">
                  <span>Variant</span>
                  <span>Qty</span>
                  <span>Unit price in bundle</span>
                  <span />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Button size="sm" onClick={() => up({ components: [...draft.components, { itemId: '', variantId: '', qty: 1 } as BundleComponent] })}>
                  Add component
                </Button>
                <span className="hint text-xs">Blank unit price = proportional split of the bundle price by list price.</span>
              </div>
            </div>
          )}

          {/* TAB 3: STOCK & SALES HISTORY */}
          {tab === 'history' && !isNew && (
            <div className="space-y-4">
              {!isBundle && (
                <div>
                  <h3 className="font-bold text-sm mb-2">Current Stock</h3>
                  {stock.length === 0 ? <p className="hint">No stock recorded yet.</p> : (
                    <div className="border border-line rounded-lg overflow-hidden bg-white">
                      <div className="grid grid-cols-[minmax(0,1fr)_70px_70px_70px] gap-2 p-2 bg-cream-2 hint font-bold text-xs">
                        <span>Variant</span>
                        <span className="text-right">On hand</span>
                        <span className="text-right">Committed</span>
                        <span className="text-right">Available</span>
                      </div>
                      {stock.map((r) => (
                        <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_70px_70px_70px] gap-2 p-2 border-t border-line text-sm">
                          <span className="truncate font-medium">{labelOf(r.itemId, r.variantId).variant || '—'}</span>
                          <span className="text-right tabular-nums">{r.onHand}</span>
                          <span className="text-right tabular-nums">{r.committed}</span>
                          <span className={`text-right tabular-nums font-bold ${r.available <= 0 ? 'text-red-ink' : ''}`}>{r.available}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {soldPerEvent.length > 0 && (
                <div>
                  <h3 className="font-bold text-sm mb-2">Sold Per Event</h3>
                  <div className="border border-line rounded-lg p-2 bg-white space-y-1">
                    {soldPerEvent.map((s) => <Kv key={s.eventId} k={s.name} v={s.sold} />)}
                  </div>
                </div>
              )}

              {history.length > 0 && (
                <div>
                  <h3 className="font-bold text-sm mb-2">Recent Movements</h3>
                  <TableWrap>
                    <thead>
                      <tr><th>When</th><th>Variant</th><th>Reason</th><th className="num">Qty</th></tr>
                    </thead>
                    <tbody>
                      {history.map((m) => (
                        <tr key={m.id}>
                          <td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                          <td>{labelOf(m.itemId, m.variantId).variant || '—'}</td>
                          <td><StatusPill status={m.reason} /></td>
                          <td className="num">{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete this item?"
        confirmLabel="Delete"
        danger
      >
        It has no stock movements or orders, so it can be removed completely.
      </Confirm>
    </>
  );
}

function VariantsEditorModalSection({
  variants,
  defaultPrice,
  defaultOtsPrice,
  onChange,
  usedIds,
}: {
  variants: Variant[];
  defaultPrice: number;
  defaultOtsPrice?: number;
  onChange: (v: Variant[]) => void;
  usedIds: Set<string>;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-bold text-sm">Variants</h3>
        <span className="hint text-xs">Leave empty for an item without variants.</span>
      </div>
      <div className="grid gap-2">
        {variants.map((v, idx) => (
          <div key={v.id} className="grid grid-cols-[auto_minmax(0,1.2fr)_100px_90px_90px_auto_auto] items-center gap-2 p-2 border border-line rounded-md bg-white">
            <ThumbnailInput
              size="sm"
              value={v.thumbnailId}
              title="Variant thumbnail"
              onChange={(thumbnailId) => {
                const next = [...variants];
                next[idx] = { ...v, thumbnailId };
                if (!thumbnailId) delete next[idx].thumbnailId;
                onChange(next);
              }}
            />
            <Input
              small
              value={v.name}
              placeholder="Variant name (e.g. 2XL, Gigi)"
              onChange={(e) => {
                const next = [...variants];
                next[idx] = { ...v, name: e.target.value };
                onChange(next);
              }}
            />
            <Input
              small
              value={v.sku ?? ''}
              placeholder="SKU"
              onChange={(e) => {
                const next = [...variants];
                next[idx] = { ...v, sku: e.target.value || undefined };
                onChange(next);
              }}
            />
            <Input
              small
              type="number"
              min={0}
              placeholder={`PO: ${defaultPrice}`}
              value={v.price ?? ''}
              title="Specific PO Price"
              onChange={(e) => {
                const next = [...variants];
                const val = e.target.value === '' ? undefined : Number(e.target.value);
                next[idx] = { ...v, price: val };
                onChange(next);
              }}
            />
            <Input
              small
              type="number"
              min={0}
              placeholder={`OTS: ${defaultOtsPrice ?? defaultPrice}`}
              value={v.otsPrice ?? ''}
              title="Specific OTS Price"
              onChange={(e) => {
                const next = [...variants];
                const val = e.target.value === '' ? undefined : Number(e.target.value);
                next[idx] = { ...v, otsPrice: val };
                onChange(next);
              }}
            />
            <Checkbox
              label="Active"
              checked={v.active}
              onChange={(e) => {
                const next = [...variants];
                next[idx] = { ...v, active: e.target.checked };
                onChange(next);
              }}
            />
            {usedIds.has(v.id) ? (
              <span title="Has stock or orders, cannot be removed"><Pill>In use</Pill></span>
            ) : (
              <Button size="sm" variant="quiet" onClick={() => onChange(variants.filter((_, i) => i !== idx))}>
                ✕
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Button size="sm" onClick={() => onChange([...variants, { id: newId(6), name: '', active: true }])}>
          + Add variant
        </Button>
      </div>
    </div>
  );
}
