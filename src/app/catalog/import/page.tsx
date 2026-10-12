'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { itemRepo } from '@/lib/repo';
import { parseCsv, type CsvRow } from '@/lib/csv';
import { newId } from '@/lib/keys';
import type { Item } from '@/types';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Field';
import { PageHeader, Panel, Pill, TableWrap } from '@/components/ui/Bits';

type Draft = Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>;
interface Parsed { row: number; draft: Draft; problems: string[] }

const COLUMNS = 'name, type, manager, price, cost, producedAt, variants, notes';

export default function ImportPage() {
  const { items, staff, settings } = useData();
  const { me } = useAuth();
  const { run } = useToast();
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = useMemo<{ rows: Parsed[]; errors: string[] }>(() => {
    if (!text.trim()) return { rows: [], errors: [] };
    const { rows, errors } = parseCsv(text);
    const staffByEmail = new Map(staff.map((s) => [s.email.toLowerCase(), s]));
    const staffByName = new Map(staff.map((s) => [s.displayName.toLowerCase(), s]));
    const existingNames = new Set(items.map((i) => i.name.toLowerCase()));
    const out: Parsed[] = rows.map((r: CsvRow, idx) => {
      const problems: string[] = [];
      const name = r.name ?? '';
      if (!name) problems.push('Missing name');
      if (existingNames.has(name.toLowerCase())) problems.push('An item with this name already exists');
      const type = (r.type ?? '').toLowerCase() || settings.itemTypes[0];
      if (!settings.itemTypes.includes(type)) problems.push(`Unknown type "${type}"`);
      const mgrText = (r.manager ?? '').toLowerCase();
      const mgr = staffByEmail.get(mgrText) ?? staffByName.get(mgrText);
      if (!mgr) problems.push(`Unknown manager "${r.manager ?? ''}"`);
      const price = Number((r.price ?? '').replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(price) || price < 0) problems.push('Bad price');
      const costRaw = (r.cost ?? '').replace(/[^\d.-]/g, '');
      const cost = costRaw ? Number(costRaw) : undefined;
      const variants = (r.variants ?? '').split('|').map((v) => v.trim()).filter(Boolean).map((v) => ({ id: newId(6), name: v, active: true }));
      const draft: Draft = {
        name, kind: 'product', type, managerId: mgr?.id ?? '', price: Math.round(price || 0),
        producedAt: r.producedAt ?? '', active: true, variants, components: [], notes: r.notes ?? '',
      };
      if (cost !== undefined && Number.isFinite(cost)) draft.cost = Math.round(cost);
      return { row: idx + 2, draft, problems };
    });
    return { rows: out, errors };
  }, [text, staff, items, settings.itemTypes]);

  const good = parsed.rows.filter((r) => r.problems.length === 0);
  const bad = parsed.rows.length - good.length;

  const onFile = async (f: File | undefined) => { if (f) setText(await f.text()); };

  const importAll = async () => {
    setBusy(true);
    const ok = await run(() => itemRepo.bulkCreate(good.map((g) => g.draft), me), `Imported ${good.length} items`);
    setBusy(false);
    if (ok) router.push('/catalog/');
  };

  return (
    <>
      <PageHeader title="Import catalogue from CSV" actions={<Button href="/catalog/">Back</Button>}>
        Export the catalogue sheet as CSV. Bundles are added by hand afterwards.
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          <Panel>
            <div className="flex flex-wrap items-center gap-3">
              <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
              <span className="hint">or paste CSV text below</span>
            </div>
            <Textarea className="mt-3 font-mono text-[12.5px]" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={`name,type,manager,price,cost,producedAt,variants,notes\nUmamusume Keychain,keychain,staff@example.com,35000,,Acrylic vendor A,Special Week|Silence Suzuka,`} />
          </Panel>

          {parsed.errors.length > 0 && <Panel className="border-red-ink/40 bg-red-soft"><b>CSV problems</b><ul className="mt-1 list-disc pl-5 text-sm">{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Panel>}

          {parsed.rows.length > 0 && (
            <TableWrap>
              <thead><tr><th>Row</th><th>Name</th><th>Type</th><th>Manager</th><th className="num">Price</th><th>Variants</th><th>Check</th></tr></thead>
              <tbody>
                {parsed.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="mono">{r.row}</td>
                    <td className="font-semibold">{r.draft.name}</td>
                    <td>{r.draft.type}</td>
                    <td>{staff.find((s) => s.id === r.draft.managerId)?.displayName ?? '—'}</td>
                    <td className="num">{r.draft.price}</td>
                    <td className="text-ink-2">{r.draft.variants.map((v) => v.name).join(', ') || '—'}</td>
                    <td>{r.problems.length === 0 ? <Pill tone="green">OK</Pill> : <span className="text-red-ink text-sm">{r.problems.join('; ')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
        <div className="grid gap-4 content-start">
          <Panel>
            <h2 className="font-bold mb-2">Columns</h2>
            <p className="text-sm text-ink-2 mb-2">Header row required. Recognised columns:</p>
            <code className="text-xs block mb-3">{COLUMNS}</code>
            <ul className="text-sm text-ink-2 list-disc pl-5 grid gap-1">
              <li><b>manager</b> is a staff email or display name.</li>
              <li><b>variants</b> are names separated by <code>|</code>.</li>
              <li><b>type</b> must be one of: {settings.itemTypes.join(', ')}. Edit the list in Settings first if needed.</li>
              <li>Prices are whole numbers in {settings.currency}.</li>
              <li>Rows with problems are skipped; fix and re-import them.</li>
            </ul>
          </Panel>
          <Panel>
            <div className="stat-num">{good.length}</div>
            <div className="hint">ready to import{bad > 0 && `, ${bad} skipped`}</div>
            <Button variant="primary" className="mt-3 w-full" disabled={good.length === 0} busy={busy} onClick={importAll}>Import {good.length} items</Button>
          </Panel>
        </div>
      </div>
    </>
  );
}
