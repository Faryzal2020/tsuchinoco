'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { itemRepo } from '@/lib/repo';
import { allocateBundlePrice } from '@/lib/bundle';
import { stockRows } from '@/lib/compute';
import { newId, splitKey, variantKey } from '@/lib/keys';
import { formatDateTime, formatMoney, titleCase } from '@/lib/format';
import type { BundleComponent, Item, Variant } from '@/types';
import Button from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Kv, PageHeader, Panel, Pill, StatusPill, TableWrap } from '@/components/ui/Bits';
import { Confirm } from '@/components/ui/Dialog';
import { VariantSelect, useVariantLabel } from '@/components/VariantSelect';
import { QueryPage, useQuery } from '@/lib/useQuery';

type Draft = Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>;

const blank = (kind: 'product' | 'bundle', type: string, managerId: string): Draft => ({
  name: '', kind, type: kind === 'bundle' ? 'bundle' : type, managerId, price: 0, producedAt: '', active: true,
  variants: [], components: [], notes: '',
});

function ItemEditor() {
  const { get } = useQuery();
  const router = useRouter();
  const { items, itemsById, staff, settings, movements, openOrders, events, staffName } = useData();
  const { me } = useAuth();
  const { run } = useToast();
  const id = get('id');
  const newKind = get('new') as 'product' | 'bundle' | '';
  const existing = id ? itemsById.get(id) : undefined;
  const isNew = !id;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (draft) return;
    if (existing) {
      const { id: _id, createdAt: _c, updatedAt: _u, updatedBy: _b, ...rest } = existing;
      void _id; void _c; void _u; void _b;
      setDraft({ ...rest, variants: rest.variants ?? [], components: rest.components ?? [], notes: rest.notes ?? '', producedAt: rest.producedAt ?? '' });
    } else if (isNew) {
      setDraft(blank(newKind === 'bundle' ? 'bundle' : 'product', settings.itemTypes[0] ?? 'other', me));
    }
  }, [existing, isNew, newKind, settings.itemTypes, me, draft]);

  const labelOf = useVariantLabel();

  const stock = useMemo(() => (id ? stockRows(items, movements, openOrders).filter((r) => r.itemId === id) : []), [items, movements, openOrders, id]);
  const history = useMemo(() => movements.filter((m) => m.itemId === id).slice(0, 50), [movements, id]);
  const soldPerEvent = useMemo(() => {
    const m = new Map<string, number>();
    for (const mv of movements) {
      if (mv.itemId !== id || !mv.eventId) continue;
      if (mv.reason === 'pickup' || mv.reason === 'walkin' || mv.reason === 'shipped') m.set(mv.eventId, (m.get(mv.eventId) ?? 0) - mv.qty);
    }
    return [...m.entries()].map(([eventId, sold]) => ({ eventId, sold, name: events.find((e) => e.id === eventId)?.name ?? eventId }));
  }, [movements, id, events]);

  const referenced = useMemo(() => {
    if (!id) return false;
    if (movements.some((m) => m.itemId === id)) return true;
    if (openOrders.some((o) => o.lines.some((l) => l.itemId === id) || o.rawLines.some((l) => l.itemId === id))) return true;
    if (items.some((i) => i.components.some((c) => c.itemId === id))) return true;
    return false;
  }, [id, movements, openOrders, items]);

  if (!draft) return null;
  if (id && !existing) return <Panel>This item no longer exists.</Panel>;

  const up = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const isBundle = draft.kind === 'bundle';

  const valid = draft.name.trim().length > 0 && draft.managerId && draft.price >= 0 &&
    (!isBundle || (draft.components.length > 0 && draft.components.every((c) => c.itemId && c.variantId && c.qty > 0)));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const data: Draft = {
      ...draft,
      name: draft.name.trim(),
      variants: isBundle ? [] : draft.variants.filter((v) => v.name.trim()).map((v) => ({ ...v, name: v.name.trim() })),
      components: isBundle ? draft.components : [],
    };
    if (data.cost === undefined || Number.isNaN(data.cost)) delete data.cost;
    const ok = await run(async () => {
      if (id) await itemRepo.patch(id, data, me);
      else {
        const newIdv = await itemRepo.create(data, me);
        router.replace(`/catalog/item/?id=${newIdv}`);
      }
    }, 'Saved');
    setSaving(false);
    if (ok && id) router.push('/catalog/');
  };

  const remove = async () => {
    if (!id) return;
    const ok = await run(() => itemRepo.remove(id), 'Deleted');
    if (ok) router.push('/catalog/');
  };

  // Bundle preview split
  const alloc = isBundle ? allocateBundlePrice({ price: draft.price, components: draft.components }, itemsById) : new Map<string, number>();
  const listTotal = isBundle ? draft.components.reduce((s, c) => s + c.qty * (itemsById.get(c.itemId)?.price ?? 0), 0) : 0;

  return (
    <>
      <PageHeader
        eyebrow={isNew ? (isBundle ? 'New bundle' : 'New item') : (isBundle ? 'Bundle' : 'Item')}
        title={isNew ? (draft.name || 'Untitled') : existing!.name}
        actions={
          <>
            <Button href="/catalog/">Back</Button>
            {!isNew && (referenced
              ? <Button onClick={() => up({ active: !draft.active })}>{draft.active ? 'Mark inactive' : 'Mark active'}</Button>
              : <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>)}
            <Button variant="primary" onClick={save} busy={saving} disabled={!valid}>Save</Button>
          </>
        }
      >
        {!isNew && <span className="hint">Last edited {formatDateTime(existing!.updatedAt)} by {staffName(existing!.updatedBy)}</span>}
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          <Panel>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2"><Input value={draft.name} onChange={(e) => up({ name: e.target.value })} autoFocus={isNew} /></Field>
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
                  {staff.filter((s) => s.active || s.id === draft.managerId).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                </Select>
              </Field>
              <Field label={`Price (${settings.currency})`}><Input type="number" min={0} value={draft.price} onChange={(e) => up({ price: Number(e.target.value) })} /></Field>
              <Field label={`Unit cost (${settings.currency}), optional`} hint="Only used for the margin column on reports.">
                <Input type="number" min={0} value={draft.cost ?? ''} onChange={(e) => up({ cost: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </Field>
              {!isBundle && <Field label="Produced at" hint="Where this is made. Free text." className="sm:col-span-2"><Input value={draft.producedAt} onChange={(e) => up({ producedAt: e.target.value })} /></Field>}
              <Field label="Notes" className="sm:col-span-2"><Textarea value={draft.notes} onChange={(e) => up({ notes: e.target.value })} /></Field>
              <Checkbox label="Active (offered in new batches)" checked={draft.active} onChange={(e) => up({ active: e.target.checked })} />
            </div>
          </Panel>

          {!isBundle && <VariantsEditor variants={draft.variants} onChange={(variants) => up({ variants })} usedIds={new Set(stock.filter((r) => r.onHand !== 0 || r.committed !== 0).map((r) => r.variantId))} />}

          {isBundle && (
            <Panel>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-bold">Components</h2>
                <span className="hint">List total {formatMoney(listTotal, settings.currency)} · bundle {formatMoney(draft.price, settings.currency)}</span>
              </div>
              <div className="grid gap-2">
                {draft.components.map((c, idx) => {
                  const key = c.itemId ? variantKey(c.itemId, c.variantId) : '';
                  const proposed = alloc.get(key);
                  return (
                    <div key={idx} className="grid grid-cols-[minmax(0,1fr)_70px_120px_auto] items-center gap-2">
                      <VariantSelect small value={key} excludeItemId={id || undefined} onChange={(k) => {
                        const next = [...draft.components];
                        const { itemId, variantId } = k ? splitKey(k) : { itemId: '', variantId: '' };
                        next[idx] = { ...c, itemId, variantId };
                        up({ components: next });
                      }} />
                      <Input small type="number" min={1} value={c.qty} title="Quantity" onChange={(e) => { const next = [...draft.components]; next[idx] = { ...c, qty: Number(e.target.value) }; up({ components: next }); }} />
                      <Input small type="number" min={0} placeholder={proposed !== undefined ? `${proposed}` : 'auto'} value={c.allocatedPrice ?? ''} title="Allocated unit price (blank = proportional)"
                        onChange={(e) => { const next = [...draft.components]; const v = e.target.value; next[idx] = { ...c, allocatedPrice: v === '' ? undefined : Number(v) }; if (v === '') delete next[idx].allocatedPrice; up({ components: next }); }} />
                      <Button size="sm" variant="quiet" onClick={() => up({ components: draft.components.filter((_, i) => i !== idx) })}>Remove</Button>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[minmax(0,1fr)_70px_120px_auto] gap-2 hint px-1"><span>Variant</span><span>Qty</span><span>Unit price in bundle</span><span /></div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Button size="sm" onClick={() => up({ components: [...draft.components, { itemId: '', variantId: '', qty: 1 } as BundleComponent] })}>Add component</Button>
                <span className="hint">Blank unit price = proportional split of the bundle price by list price. The rounding remainder lands on the last component.</span>
              </div>
            </Panel>
          )}
        </div>

        <div className="grid gap-5 content-start">
          {!isNew && !isBundle && (
            <Panel>
              <h2 className="mb-2 font-bold">Stock</h2>
              {stock.length === 0 ? <p className="hint">No stock rows yet.</p> : (
                <div>
                  <div className="grid grid-cols-[minmax(0,1fr)_56px_56px_56px] gap-2 hint mb-1"><span>Variant</span><span className="text-right">On hand</span><span className="text-right">Committed</span><span className="text-right">Avail.</span></div>
                  {stock.map((r) => (
                    <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_56px_56px_56px] gap-2 py-1 border-t border-line text-sm">
                      <span className="truncate">{labelOf(r.itemId, r.variantId).variant || '—'}</span>
                      <span className="text-right tabular-nums">{r.onHand}</span>
                      <span className="text-right tabular-nums">{r.committed}</span>
                      <span className={`text-right tabular-nums font-semibold ${r.available <= 0 ? 'text-red-ink' : ''}`}>{r.available}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}
          {!isNew && soldPerEvent.length > 0 && (
            <Panel>
              <h2 className="mb-2 font-bold">Sold per event</h2>
              {soldPerEvent.map((s) => <Kv key={s.eventId} k={s.name} v={s.sold} />)}
            </Panel>
          )}
          {!isNew && history.length > 0 && (
            <Panel pad={false}>
              <h2 className="px-5 pt-4 pb-2 font-bold">Recent movements</h2>
              <TableWrap className="border-0 rounded-none">
                <thead><tr><th>When</th><th>Variant</th><th>Reason</th><th className="num">Qty</th></tr></thead>
                <tbody>
                  {history.map((m) => (
                    <tr key={m.id}><td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</td><td>{labelOf(m.itemId, m.variantId).variant || '—'}</td><td><StatusPill status={m.reason} /></td><td className="num">{m.qty > 0 ? `+${m.qty}` : m.qty}</td></tr>
                  ))}
                </tbody>
              </TableWrap>
            </Panel>
          )}
          {!isNew && referenced && <p className="hint px-1">This item is referenced by stock, orders, or a bundle, so it can be made inactive but not deleted.</p>}
        </div>
      </div>

      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} title="Delete this item?" confirmLabel="Delete" danger>
        It has no stock movements or orders, so it can be removed completely.
      </Confirm>
    </>
  );
}

function VariantsEditor({ variants, onChange, usedIds }: { variants: Variant[]; onChange: (v: Variant[]) => void; usedIds: Set<string> }) {
  return (
    <Panel>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-bold">Variants</h2>
        <span className="hint">Leave empty for an item with no variants.</span>
      </div>
      <div className="grid gap-2 mt-3">
        {variants.map((v, idx) => (
          <div key={v.id} className="flex items-center gap-2">
            <Input small value={v.name} placeholder="Variant name, e.g. EN / Tall / Character name" onChange={(e) => { const next = [...variants]; next[idx] = { ...v, name: e.target.value }; onChange(next); }} />
            <Checkbox label="Active" checked={v.active} onChange={(e) => { const next = [...variants]; next[idx] = { ...v, active: e.target.checked }; onChange(next); }} />
            {usedIds.has(v.id)
              ? <span title="Has stock or orders, cannot be removed"><Pill>In use</Pill></span>
              : <Button size="sm" variant="quiet" onClick={() => onChange(variants.filter((_, i) => i !== idx))}>Remove</Button>}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Button size="sm" onClick={() => onChange([...variants, { id: newId(6), name: '', active: true }])}>Add variant</Button>
      </div>
    </Panel>
  );
}

export default function Page() {
  return <QueryPage><ItemEditor /></QueryPage>;
}
