'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data';
import { usePrefs } from '@/lib/prefs';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { movementRepo } from '@/lib/repo';
import { onHandByKey } from '@/lib/compute';
import { variantKey, variantsOf } from '@/lib/keys';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { PageHeader, Panel, TableWrap } from '@/components/ui/Bits';
import { Confirm } from '@/components/ui/Dialog';

export default function StockTakePage() {
  const { items, movements, staffName } = useData();
  const { isMine } = usePrefs();
  const { me } = useAuth();
  const { run } = useToast();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const onHand = useMemo(() => onHandByKey(movements), [movements]);
  const isOpening = movements.length === 0;

  const rows = useMemo(() => {
    const out: { key: string; item: string; variant: string; manager: string; onHand: number }[] = [];
    for (const item of items) {
      if (item.kind !== 'product' || !item.active || !isMine(item)) continue;
      for (const v of variantsOf(item)) {
        if (!v.active) continue;
        const key = variantKey(item.id, v.id);
        out.push({ key, item: item.name, variant: v.name, manager: staffName(item.managerId), onHand: onHand.get(key) ?? 0 });
      }
    }
    return out;
  }, [items, onHand, isMine, staffName]);

  const changes = rows.flatMap((r) => {
    const t = (counts[r.key] ?? '').trim();
    if (t === '') return [];
    const n = Number(t);
    if (!Number.isFinite(n)) return [];
    const diff = Math.round(n) - r.onHand;
    return diff === 0 ? [] : [{ ...r, counted: Math.round(n), diff }];
  });

  const post = async () => {
    setBusy(true);
    const ok = await run(() => movementRepo.bulkCreate(changes.map((c) => {
      const [itemId, variantId] = [c.key.slice(0, c.key.indexOf(':')), c.key.slice(c.key.indexOf(':') + 1)];
      return { itemId, variantId, qty: c.diff, reason: isOpening ? 'opening' as const : 'correction' as const, note: isOpening ? 'Opening stock' : `Stock take: counted ${c.counted}` };
    }), me), `Posted ${changes.length} ${isOpening ? 'opening balances' : 'corrections'}`);
    setBusy(false);
    setConfirm(false);
    if (ok) router.push('/stock/');
  };

  let lastItem = '';
  return (
    <>
      <PageHeader title={isOpening ? 'Opening stock' : 'Stock take'} actions={<><Button href="/stock/">Cancel</Button><Button variant="primary" disabled={changes.length === 0} onClick={() => setConfirm(true)}>Review {changes.length} changes</Button></>}>
        {isOpening ? 'Enter the current count for every variant. This becomes the opening balance.' : 'Enter the physical count. Rows left blank are skipped. Only differences are posted.'}
      </PageHeader>
      {rows.length === 0 ? <Panel>No active variants. Add items to the catalogue first.</Panel> : (
        <TableWrap>
          <thead><tr><th>Item</th><th>Variant</th><th>Manager</th><th className="num">On hand</th><th className="num">Counted</th><th className="num">Difference</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const first = lastItem !== r.item; lastItem = r.item;
              const t = (counts[r.key] ?? '').trim();
              const diff = t === '' || !Number.isFinite(Number(t)) ? null : Math.round(Number(t)) - r.onHand;
              return (
                <tr key={r.key}>
                  <td className="font-semibold">{first ? r.item : ''}</td>
                  <td>{r.variant || '—'}</td>
                  <td className="text-ink-2">{first ? r.manager : ''}</td>
                  <td className="num">{r.onHand}</td>
                  <td className="num"><Input small inputMode="numeric" className="num-cell ml-auto" value={counts[r.key] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [r.key]: e.target.value }))} /></td>
                  <td className={`num font-semibold ${diff === null ? 'text-muted' : diff < 0 ? 'text-red-ink' : diff > 0 ? 'text-green-ink' : ''}`}>{diff === null ? '' : diff > 0 ? `+${diff}` : diff}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
      <Confirm open={confirm} onClose={() => setConfirm(false)} onConfirm={post} busy={busy} title={`Post ${changes.length} ${isOpening ? 'opening balances' : 'corrections'}?`} confirmLabel="Post">
        <ul className="max-h-60 overflow-y-auto grid gap-1">
          {changes.map((c) => <li key={c.key}>{c.item}{c.variant ? ` · ${c.variant}` : ''}: {c.onHand} → <b>{c.counted}</b> ({c.diff > 0 ? '+' : ''}{c.diff})</li>)}
        </ul>
      </Confirm>
    </>
  );
}
