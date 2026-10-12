'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data';
import { usePrefs } from '@/lib/prefs';
import { formatMoney, titleCase } from '@/lib/format';
import { onHandByKey } from '@/lib/compute';
import { variantKey, variantsOf } from '@/lib/keys';
import { downloadCsv, toCsv } from '@/lib/csv';
import Button from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Empty, PageHeader, Pill, TableWrap } from '@/components/ui/Bits';
import { QueryPage, useQuery } from '@/lib/useQuery';

function CatalogList() {
  const { items, staff, settings, movements, staffName } = useData();
  const { isMine } = usePrefs();
  const { get, set } = useQuery();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const type = get('type');
  const manager = get('manager');
  const active = get('active', 'active');

  const onHand = useMemo(() => onHandByKey(movements), [movements]);

  const rows = useMemo(() => items.filter((i) => {
    if (type && i.type !== type) return false;
    if (manager && i.managerId !== manager) return false;
    if (active === 'active' && !i.active) return false;
    if (active === 'inactive' && i.active) return false;
    if (!isMine(i)) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [items, type, manager, active, isMine, search]);

  const stockOf = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item || item.kind !== 'product') return null;
    return variantsOf(item).reduce((s, v) => s + (onHand.get(variantKey(item.id, v.id)) ?? 0), 0);
  };

  const exportCsv = () => {
    downloadCsv('catalogue', toCsv(rows.map((i) => ({
      name: i.name, kind: i.kind, type: i.type, manager: staffName(i.managerId), price: i.price, cost: i.cost ?? '',
      producedAt: i.producedAt, active: i.active ? 'yes' : 'no',
      variants: i.variants.map((v) => v.name).join('|'),
      components: i.components.map((c) => `${c.itemId}:${c.variantId}x${c.qty}`).join('|'),
      onHand: stockOf(i.id) ?? '', notes: i.notes,
    }))));
  };

  return (
    <>
      <PageHeader
        title="Catalogue"
        actions={
          <>
            <Button onClick={exportCsv}>Export CSV</Button>
            <Button href="/catalog/import/">Import CSV</Button>
            <Button href="/catalog/item/?new=bundle">New bundle</Button>
            <Button variant="primary" href="/catalog/item/?new=product">New item</Button>
          </>
        }
      >
        {items.length} items, {items.filter((i) => i.kind === 'bundle').length} bundles.
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-[220px]" />
        <Select value={type} onChange={(e) => set({ type: e.target.value })} className="w-[160px]">
          <option value="">All types</option>
          {settings.itemTypes.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          <option value="bundle">Bundle</option>
        </Select>
        <Select value={manager} onChange={(e) => set({ manager: e.target.value })} className="w-[180px]">
          <option value="">All managers</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        </Select>
        <Select value={active} onChange={(e) => set({ active: e.target.value })} className="w-[140px]">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </Select>
      </div>

      {rows.length === 0 ? (
        <Empty title={items.length === 0 ? 'The catalogue is empty' : 'Nothing matches these filters'}
          action={items.length === 0 ? <Button href="/catalog/import/">Import from CSV</Button> : undefined}>
          {items.length === 0 && 'Import the catalogue sheet as CSV, or add items one by one.'}
        </Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Name</th><th>Type</th><th>Manager</th><th className="num">Price</th><th className="num">Variants</th><th className="num">On hand</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const stock = stockOf(i.id);
              return (
                <tr key={i.id} className="clickable" onClick={() => router.push(`/catalog/item/?id=${i.id}`)}>
                  <td className="font-semibold">{i.name}{i.kind === 'bundle' && <Pill tone="blue" className="ml-2">Bundle</Pill>}</td>
                  <td>{titleCase(i.type)}</td>
                  <td>{staffName(i.managerId)}</td>
                  <td className="num">{formatMoney(i.price, settings.currency)}</td>
                  <td className="num">{i.kind === 'bundle' ? `${i.components.length} parts` : i.variants.length || '—'}</td>
                  <td className="num">{stock === null ? '—' : stock}</td>
                  <td>{i.active ? <Pill tone="green">Active</Pill> : <Pill>Inactive</Pill>}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}

export default function Page() {
  return <QueryPage><CatalogList /></QueryPage>;
}
