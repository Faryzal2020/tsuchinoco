'use client';

// Storefront and order settings: which catalogue price each order type uses, the checkout grace
// period, couriers for tracking numbers, and the one-off setup for price history and old orders.
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { orderRepo, settingsRepo } from '@/lib/repo';
import { storefrontOf } from '@/lib/pricing';
import { syncPriceBasis, syncPriceList } from '@/lib/prices';
import { formatDateTime } from '@/lib/format';
import type { Courier, OrderType, StorefrontSettings } from '@/types';
import Button from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Bits';

const TYPES: { id: OrderType; label: string; hint: string }[] = [
  { id: 'preorder', label: 'Preorder price', hint: 'Preorders for an event, on the Forms and later the storefront.' },
  { id: 'mail_order', label: 'Mail order price', hint: 'Post-event batches and regular mail orders.' },
];

export default function StorefrontPanel() {
  const { settings, publicPrices, batches, events } = useData();
  const { me } = useAuth();
  const { run, toast } = useToast();
  const [sf, setSf] = useState<StorefrontSettings>(storefrontOf(settings));
  useEffect(() => setSf(storefrontOf(settings)), [settings]);

  const setBasis = (t: OrderType, v: 'po' | 'ots') => setSf({ ...sf, priceBasis: { ...sf.priceBasis, [t]: v } });
  const setCourier = (i: number, c: Partial<Courier>) => setSf({ ...sf, couriers: sf.couriers.map((x, j) => (j === i ? { ...x, ...c } : x)) });

  const save = () => run(async () => {
    const clean: StorefrontSettings = {
      ...sf,
      graceMinutes: Math.max(0, Math.round(Number(sf.graceMinutes) || 0)),
      couriers: sf.couriers.map((c) => ({ name: c.name.trim(), ...(c.trackingUrl?.trim() ? { trackingUrl: c.trackingUrl.trim() } : {}) })).filter((c) => c.name),
    };
    await settingsRepo.save({ currency: settings.currency, itemTypes: settings.itemTypes, pickupDeadlineDays: settings.pickupDeadlineDays, storefront: clean }, me);
    await syncPriceBasis({ storefront: clean });
  }, 'Saved. Open forms use the new prices within seconds.');

  const setupPrices = () => run(async () => {
    await syncPriceBasis(settings);
    const n = await syncPriceList(me);
    toast(n === 0 ? 'Price list already up to date' : `Recorded ${n} prices`);
  });
  const backfill = () => run(async () => {
    const n = await orderRepo.backfillTypes(batches, events, me);
    toast(n === 0 ? 'Every order already has a type and payment' : `Updated ${n} orders`);
  });

  const keys = Object.keys(publicPrices?.items ?? {}).length;

  return (
    <Panel>
      <h2 className="font-bold mb-1">Prices and orders</h2>
      <p className="hint mb-3">Price changes in the catalogue reach every open form within seconds. Orders already placed keep the price they were made at.</p>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {TYPES.map((t) => (
            <Field key={t.id} label={t.label} hint={t.hint}>
              <Select value={sf.priceBasis[t.id]} onChange={(e) => setBasis(t.id, e.target.value as 'po' | 'ots')}>
                <option value="po">PO price</option>
                <option value="ots">OTS price</option>
              </Select>
            </Field>
          ))}
        </div>
        <Field label="Grace period for price changes (minutes)" hint="A customer who saw the old price this long before a change still gets it. Later submissions are charged the new price and flagged.">
          <Input type="number" min={0} value={sf.graceMinutes} onChange={(e) => setSf({ ...sf, graceMinutes: Number(e.target.value) })} className="w-[120px]" />
        </Field>
        <div>
          <span className="label">Couriers</span>
          <p className="hint mb-2">Offered when marking an order delivered. A tracking link with <span className="mono">{'{number}'}</span> where the tracking number goes is optional.</p>
          <div className="grid gap-2">
            {sf.couriers.map((c, i) => (
              <div key={i} className="grid gap-2 grid-cols-[140px_minmax(0,1fr)_auto] items-center">
                <Input small value={c.name} placeholder="Courier" onChange={(e) => setCourier(i, { name: e.target.value })} aria-label="Courier name" />
                <Input small value={c.trackingUrl ?? ''} placeholder="https://…{number}" onChange={(e) => setCourier(i, { trackingUrl: e.target.value })} aria-label="Tracking link" />
                <Button size="sm" variant="quiet" onClick={() => setSf({ ...sf, couriers: sf.couriers.filter((_, j) => j !== i) })}>Remove</Button>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-2" onClick={() => setSf({ ...sf, couriers: [...sf.couriers, { name: '' }] })}>Add courier</Button>
        </div>
        <div><Button variant="primary" onClick={save}>Save</Button></div>

        <div className="border-t border-line pt-3 grid gap-2">
          <h3 className="font-bold text-sm">One-off setup</h3>
          <p className="hint">
            {publicPrices ? `Live price list: ${keys} prices, updated ${formatDateTime(publicPrices.updatedAt)}.` : 'No live price list yet. Until it exists, forms show the prices from their last publish.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={setupPrices}>{publicPrices ? 'Re-check price list' : 'Set up price list'}</Button>
            <Button onClick={backfill}>Add type and payment to old orders</Button>
          </div>
          <p className="hint">Old orders: picked up and delivered become paid; open orders start unpaid. Mark checked batches paid in bulk on the Orders page.</p>
        </div>
      </div>
    </Panel>
  );
}
