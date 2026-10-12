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

const COLUMNS_HELP = 'Final ID / SKU, Nama Product (name), Tipe Merch (type), Category, Project Manager (manager), PO Price (price), OTS Price, C107 Price, Artist, variants, notes';

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

    const cleanNum = (val: string | undefined): number | undefined => {
      if (!val) return undefined;
      const n = Number(val.replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
    };

    const out: Parsed[] = rows.map((r: CsvRow, idx) => {
      const problems: string[] = [];

      // Name resolution
      const name = (r['Nama Product'] || r.name || '').trim();
      if (!name) problems.push('Missing name');
      if (existingNames.has(name.toLowerCase())) problems.push('An item with this name already exists');

      // SKU resolution
      const sku = (r['Final ID / SKU'] || r.sku || r['Unique ID / SKU'] || '').trim();

      // Type resolution (fuzzy / case-insensitive)
      const rawType = (r['Tipe Merch'] || r.type || '').trim();
      const matchedType = settings.itemTypes.find((t) => t.toLowerCase() === rawType.toLowerCase()) || rawType || settings.itemTypes[0];

      // Manager resolution (Non-blocking: if staff not found, save managerName and allow import)
      const mgrRaw = (r['Project Manager'] || r.manager || '').trim();
      const mgrText = mgrRaw.toLowerCase();
      const mgr = staffByEmail.get(mgrText) ?? staffByName.get(mgrText);

      // Price resolution (PO Price, OTS Price, C107 Price)
      const rawPo = (r['PO Price'] || r.price || '').trim();
      const poPrice = rawPo ? cleanNum(rawPo) : 0;
      if (rawPo && poPrice === undefined) problems.push('Bad PO price');
      const otsPrice = cleanNum(r['OTS Price'] || r.otsPrice);
      const priceJpy = cleanNum(r['C107 Price'] || r.priceJpy || r['JPY Price']);
      const cost = cleanNum(r.cost || r.Cost);

      // Category & Artist
      const category = (r.Category || r.category || '').trim();
      const artist = (r.Artist || r.artist || '').trim();

      // Variants
      const rawVariants = (r.variants || r.Variants || '').trim();
      const variants = rawVariants
        ? rawVariants.split('|').map((v) => v.trim()).filter(Boolean).map((v) => ({ id: newId(6), name: v, active: true }))
        : [];

      const draft: Draft = {
        name,
        sku: sku || undefined,
        kind: (matchedType.toLowerCase() === 'bundle' ? 'bundle' : 'product') as Item['kind'],
        type: matchedType,
        category: category || undefined,
        artist: artist || undefined,
        managerId: mgr?.id ?? '',
        managerName: !mgr && mgrRaw ? mgrRaw : undefined,
        price: poPrice ?? 0,
        otsPrice: otsPrice !== undefined ? otsPrice : poPrice,
        priceJpy,
        cost,
        producedAt: (r.producedAt || r.ProducedAt || '').trim(),
        active: true,
        variants,
        components: [],
        notes: (r.notes || r.Notes || '').trim(),
      };

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
            <Textarea
              className="mt-3 font-mono text-[12.5px]"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Final ID / SKU,Nama Product,Tipe Merch,Category,Project Manager,PO Price,OTS Price,C107 Price,Artist\nJ_AK_UMA_GIGI,Holouma Keychain by jknor719 (Gigi),Acrylic Keychain,HOLOUMA,Jaki,"Rp35,000","Rp35,000",,jknor719`}
            />
          </Panel>

          {parsed.errors.length > 0 && (
            <Panel className="border-red-ink/40 bg-red-soft">
              <b>CSV problems</b>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {parsed.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </Panel>
          )}

          {parsed.rows.length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Manager</th>
                  <th className="num">PO Price</th>
                  <th className="num">OTS Price</th>
                  <th className="num">JPY</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((r) => {
                  const staffMember = staff.find((s) => s.id === r.draft.managerId);
                  return (
                    <tr key={r.row}>
                      <td className="mono">{r.row}</td>
                      <td className="mono text-xs">{r.draft.sku || '—'}</td>
                      <td className="font-semibold">{r.draft.name}</td>
                      <td>{r.draft.category ? <Pill tone="blue">{r.draft.category}</Pill> : '—'}</td>
                      <td>{r.draft.type}</td>
                      <td>
                        {staffMember ? (
                          staffMember.displayName
                        ) : r.draft.managerName ? (
                          <Pill tone="yellow">Unassigned ({r.draft.managerName})</Pill>
                        ) : (
                          <span className="text-ink-2">—</span>
                        )}
                      </td>
                      <td className="num">{r.draft.price.toLocaleString()}</td>
                      <td className="num">{r.draft.otsPrice ? r.draft.otsPrice.toLocaleString() : '—'}</td>
                      <td className="num">{r.draft.priceJpy ? `¥${r.draft.priceJpy.toLocaleString()}` : '—'}</td>
                      <td>
                        {r.problems.length === 0 ? (
                          <Pill tone="green">OK</Pill>
                        ) : (
                          <span className="text-red-ink text-sm">{r.problems.join('; ')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
        <div className="grid gap-4 content-start">
          <Panel>
            <h2 className="font-bold mb-2">Recognised Columns</h2>
            <p className="text-sm text-ink-2 mb-2">Supports both the Google Supersheet format and standard CSV:</p>
            <code className="text-xs block mb-3 overflow-x-auto p-1 bg-surface-2 rounded">{COLUMNS_HELP}</code>
            <ul className="text-sm text-ink-2 list-disc pl-5 grid gap-1">
              <li><b>Project Manager:</b> Automatically matched to staff. If the staff account doesn&apos;t exist yet, it safely saves their name as unassigned so you can import immediately!</li>
              <li><b>PO & OTS Price:</b> Supports formatted currency like <code>Rp35,000</code> or plain numbers.</li>
              <li><b>C107 Price:</b> Optional foreign/JPY currency price.</li>
              <li><b>Category:</b> Grouping tag (e.g. <code>HOLOUMA</code>).</li>
            </ul>
          </Panel>
          <Panel>
            <div className="stat-num">{good.length}</div>
            <div className="hint">ready to import{bad > 0 && `, ${bad} skipped`}</div>
            <Button
              variant="primary"
              className="mt-3 w-full"
              disabled={good.length === 0}
              busy={busy}
              onClick={importAll}
            >
              Import {good.length} items
            </Button>
          </Panel>
        </div>
      </div>
    </>
  );
}
