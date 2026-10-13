'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { itemRepo } from '@/lib/repo';
import { parseCsv, type CsvRow } from '@/lib/csv';
import { newId } from '@/lib/keys';
import type { Item, Variant } from '@/types';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Field';
import { CategoryPill, PageHeader, Panel, Pill, TableWrap } from '@/components/ui/Bits';

type Draft = Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>;
interface Parsed { row: number; rowLabel?: string; draft: Draft; problems: string[] }

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

    interface RawExtracted {
      rowIdx: number;
      rowNumber: number;
      rawName: string;
      baseName: string;
      variantName: string;
      isVariantPattern: boolean;
      explicitVariants: string[];
      sku: string;
      prefixSku: string;
      matchedType: string;
      mgrId: string;
      mgrName?: string;
      poPrice: number;
      rawPo: string;
      otsPrice?: number;
      priceJpy?: number;
      cost?: number;
      category?: string;
      artist?: string;
      producedAt: string;
      notes: string;
    }

    const extracted: RawExtracted[] = [];

    rows.forEach((r: CsvRow, idx: number) => {
      const rawName = (r['Nama Product'] || r.name || '').trim();
      if (!rawName) return;

      const rawVariants = (r.variants || r.Variants || '').trim();
      const explicitVariants = rawVariants
        ? rawVariants.split('|').map((v) => v.trim()).filter(Boolean)
        : [];

      // Check for "Base Name (Variant Name)"
      const match = rawName.match(/^(.+?)\s*\(([^)]+)\)$/);
      const isVariantPattern = !explicitVariants.length && !!match;
      const baseName = match ? match[1].replace(/\s+/g, ' ').trim() : rawName.replace(/\s+/g, ' ').trim();
      const variantName = match ? match[2].trim() : '';

      const prefixSku = (r['ID / SKU Prefix'] || '').trim();
      const sku = (r['Final ID / SKU'] || r.sku || r['Unique ID / SKU'] || prefixSku).trim();

      const rawType = (r['Tipe Merch'] || r.type || '').trim();
      const matchedType = settings.itemTypes.find((t) => t.toLowerCase() === rawType.toLowerCase()) || rawType || settings.itemTypes[0];

      const mgrRaw = (r['Project Manager'] || r.manager || '').trim();
      const mgrText = mgrRaw.toLowerCase();
      const mgr = staffByEmail.get(mgrText) ?? staffByName.get(mgrText);

      const rawPo = (r['PO Price'] || r.price || '').trim();
      const poPrice = rawPo ? (cleanNum(rawPo) ?? 0) : 0;
      const otsPrice = cleanNum(r['OTS Price'] || r.otsPrice);
      const priceJpy = cleanNum(r['C107 Price'] || r.priceJpy || r['JPY Price']);
      const cost = cleanNum(r.cost || r.Cost);

      const category = (r.Category || r.category || '').trim();
      const artist = (r.Artist || r.artist || '').trim();
      const producedAt = (r.producedAt || r.ProducedAt || '').trim();
      const notes = (r.notes || r.Notes || '').trim();

      extracted.push({
        rowIdx: idx,
        rowNumber: idx + 2,
        rawName,
        baseName,
        variantName,
        isVariantPattern,
        explicitVariants,
        sku,
        prefixSku,
        matchedType,
        mgrId: mgr?.id ?? '',
        mgrName: !mgr && mgrRaw ? mgrRaw : undefined,
        poPrice,
        rawPo,
        otsPrice,
        priceJpy,
        cost,
        category: category || undefined,
        artist: artist || undefined,
        producedAt,
        notes,
      });
    });

    // Count rows sharing baseName + category
    const countByBaseKey = new Map<string, number>();
    extracted.forEach((item) => {
      if (item.isVariantPattern) {
        const key = `${item.baseName.toLowerCase()}:::${(item.category || '').toLowerCase()}`;
        countByBaseKey.set(key, (countByBaseKey.get(key) ?? 0) + 1);
      }
    });

    const groupedMap = new Map<string, RawExtracted[]>();
    const outItems: Parsed[] = [];

    extracted.forEach((item) => {
      const key = `${item.baseName.toLowerCase()}:::${(item.category || '').toLowerCase()}`;
      const count = countByBaseKey.get(key) ?? 0;

      if (item.isVariantPattern && count > 1) {
        if (!groupedMap.has(key)) {
          groupedMap.set(key, []);
        }
        groupedMap.get(key)!.push(item);
      } else {
        // Individual standalone item
        const problems: string[] = [];
        if (existingNames.has(item.rawName.toLowerCase())) {
          problems.push('An item with this name already exists');
        }
        if (item.rawPo && item.poPrice === undefined) {
          problems.push('Bad PO price');
        }

        const variants = item.explicitVariants.map((v) => ({
          id: newId(6),
          name: v,
          active: true,
        }));

        const draft: Draft = {
          name: item.rawName,
          sku: item.sku || undefined,
          kind: (item.matchedType.toLowerCase() === 'bundle' ? 'bundle' : 'product') as Item['kind'],
          type: item.matchedType,
          category: item.category,
          artist: item.artist,
          managerId: item.mgrId,
          managerName: item.mgrName,
          price: item.poPrice,
          otsPrice: item.otsPrice !== undefined ? item.otsPrice : item.poPrice,
          priceJpy: item.priceJpy,
          cost: item.cost,
          producedAt: item.producedAt,
          active: true,
          variants,
          components: [],
          notes: item.notes,
        };

        outItems.push({
          row: item.rowNumber,
          draft,
          problems,
        });
      }
    });

    // Grouped multi-variant items
    groupedMap.forEach((groupRows) => {
      const first = groupRows[0];
      const last = groupRows[groupRows.length - 1];
      const problems: string[] = [];

      if (existingNames.has(first.baseName.toLowerCase())) {
        problems.push('An item with this name already exists');
      }

      groupRows.forEach((r) => {
        if (r.rawPo && r.poPrice === undefined) {
          problems.push(`Row ${r.rowNumber}: Bad PO price`);
        }
      });

      const variants: Variant[] = groupRows.map((r) => ({
        id: newId(6),
        name: r.variantName,
        sku: r.sku || undefined,
        price: r.poPrice,
        otsPrice: r.otsPrice !== undefined ? r.otsPrice : r.poPrice,
        priceJpy: r.priceJpy,
        active: true,
      }));

      const minPo = Math.min(...variants.map((v) => v.price ?? first.poPrice));
      const minOts = Math.min(...variants.map((v) => v.otsPrice ?? (first.otsPrice ?? minPo)));
      const baseSku = first.prefixSku || (first.sku && first.sku.includes('_') ? first.sku.substring(0, first.sku.lastIndexOf('_')) : first.sku);

      const draft: Draft = {
        name: first.baseName,
        sku: baseSku || undefined,
        kind: (first.matchedType.toLowerCase() === 'bundle' ? 'bundle' : 'product') as Item['kind'],
        type: first.matchedType,
        category: first.category,
        artist: first.artist,
        managerId: first.mgrId,
        managerName: first.mgrName,
        price: minPo,
        otsPrice: minOts,
        priceJpy: first.priceJpy,
        cost: first.cost,
        producedAt: first.producedAt,
        active: true,
        variants,
        components: [],
        notes: first.notes,
      };

      outItems.push({
        row: first.rowNumber,
        rowLabel: `${first.rowNumber}–${last.rowNumber}`,
        draft,
        problems,
      });
    });

    // Sort by row number to match original CSV sequence
    outItems.sort((a, b) => a.row - b.row);

    return { rows: outItems, errors };
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
                {parsed.rows.map((r, idx) => {
                  const staffMember = staff.find((s) => s.id === r.draft.managerId);
                  const hasVars = r.draft.variants.length > 0;
                  const poPrices = hasVars ? r.draft.variants.map((v) => v.price ?? r.draft.price) : [r.draft.price];
                  const minPo = Math.min(...poPrices);
                  const maxPo = Math.max(...poPrices);
                  const poDisplay = minPo === maxPo ? minPo.toLocaleString() : `${minPo.toLocaleString()} – ${maxPo.toLocaleString()}`;

                  return (
                    <tr key={`${r.row}-${idx}`}>
                      <td className="mono text-xs">{r.rowLabel || r.row}</td>
                      <td className="mono text-xs">{r.draft.sku || '—'}</td>
                      <td>
                        <span className="font-semibold">{r.draft.name}</span>
                        {hasVars && (
                          <span className="ml-2 pill pill-blue text-[11px] py-0 px-1.5" title={r.draft.variants.map((v) => v.name).join(', ')}>
                            {r.draft.variants.length} vars
                          </span>
                        )}
                      </td>
                      <td><CategoryPill category={r.draft.category} /></td>
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
                      <td className="num">{poDisplay}</td>
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
