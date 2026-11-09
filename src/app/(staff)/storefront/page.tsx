'use client';

// Staff view of the storefront: what customers can do right now and why, the mail-order switch,
// which preorder batches are listed, the shop's text, and publishing.
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { batchRepo, settingsRepo } from '@/lib/repo';
import { storeRepo } from '@/lib/storeActions';
import { isStorefrontBatch, MAIL_LANE_ID, overrideActive, storeHashFor, storeState } from '@/lib/store';
import { storefrontOf } from '@/lib/pricing';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Batch, PublicForm } from '@/types';
import Button from '@/components/ui/Button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/Field';
import { Empty, PageHeader, Panel, Pill, StatusPill, TableWrap } from '@/components/ui/Bits';

export default function StorefrontPage() {
  const { items, events, batches, formsById, publicFormsById, settings, storeCatalog, storeStatus } = useData();
  const { me } = useAuth();
  const { run } = useToast();
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const docs = useMemo(() => {
    const out: Record<string, PublicForm | undefined> = {};
    for (const l of storeCatalog?.lanes ?? []) out[l.id] = publicFormsById.get(l.id);
    return out;
  }, [storeCatalog, publicFormsById]);
  const state = storeState(storeCatalog, storeStatus, docs, now);
  const storeEvent = events.find((e) => e.kind === 'store');
  const hash = useMemo(() => (storeEvent ? storeHashFor({ items, events, batches, formsById, settings, storeEvent, status: storeStatus }) : ''), [items, events, batches, formsById, settings, storeEvent, storeStatus]);
  const changed = !storeCatalog || !storeEvent || hash !== storeCatalog.publishedHash;
  const mailLaneExists = !!publicFormsById.get(MAIL_LANE_ID);
  const override = overrideActive(storeStatus, now);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => { setBusy(key); await run(fn, ok); setBusy(''); };
  const publish = () => act('publish', async () => {
    const r = await storeRepo.publish({ items, events, batches, formsById, settings, current: storeCatalog, status: storeStatus, by: me });
    return r;
  }, 'Storefront published');

  const preorderBatches = batches
    .filter((b) => b.mode === 'preorder')
    .map((b) => ({ b, e: events.find((x) => x.id === b.eventId) }))
    .filter((x): x is { b: Batch; e: NonNullable<typeof x.e> } => !!x.e && x.e.status === 'upcoming' && x.e.kind !== 'store')
    .sort((a, b) => (a.e.startDate || '').localeCompare(b.e.startDate || '') || a.b.number - b.b.number);

  const setListed = (b: Batch, listed: boolean) => act(`list-${b.id}`, async () => {
    await batchRepo.patch(b.id, { storefront: listed }, me);
    if (b.status === 'open') {
      if (listed) await storeRepo.publish({ items, events, batches: batches.map((x) => (x.id === b.id ? { ...b, storefront: true } : x)), formsById, settings, current: storeCatalog, status: storeStatus, by: me });
      else await storeRepo.mirrorBatch(b.id, false);
    }
  });

  const hiddenFromMail = items.filter((i) => i.active && i.mailOrder === false).length;
  const shopHref = typeof window !== 'undefined' && window.location.hostname === 'admin.tsuchinoco.xyz'
    ? 'https://tsuchinoco.xyz/shop/'
    : '/shop/';

  return (
    <>
      <PageHeader title="Storefront" actions={<>
        <Button href={shopHref} target="_blank" rel="noopener noreferrer">Open the shop</Button>
        <Button variant="primary" busy={busy === 'publish'} onClick={publish}>{storeCatalog ? 'Publish changes' : 'Publish storefront'}</Button>
      </>}>
        One shop page for preorders and mail orders. Prices are always live; publish after changing items, offerings, batch dates or the text below.
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <h2 className="font-bold mb-2">What customers see now</h2>
          {state.choices.length === 0 ? (
            <p className="mb-2"><Pill>View only</Pill> <span className="ml-1">Customers can browse; cart and checkout are hidden.</span></p>
          ) : (
            <ul className="mb-2 grid gap-1">
              {state.choices.map((c) => <li key={c.lane.id}><Pill tone={c.lane.kind === 'preorder' ? 'blue' : 'yellow'}>{c.label}</Pill> <span className="hint">{c.detail}</span></li>)}
            </ul>
          )}
          <ul className="hint grid gap-0.5 list-disc pl-5">{state.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {changed ? <Pill tone="yellow">Changed since publish</Pill> : <Pill tone="green">Up to date</Pill>}
            <span className="hint">{storeCatalog ? `Version ${storeCatalog.version}, published ${formatDateTime(storeCatalog.publishedAt)} · ${storeCatalog.products.length} products` : 'Never published.'}</span>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-bold mb-1">Mail order</h2>
          <p className="hint mb-3">Regular mail orders at the mail-order price. They pause on their own while a preorder is open or an event is running, and always ship after the event ends.</p>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {storeStatus?.mailOrderOpen ? <Pill tone="green">Switched on</Pill> : <Pill>Switched off</Pill>}
            {override && <Pill tone="yellow">Override until {new Date(storeStatus!.overrideUntil!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</Pill>}
          </div>
          <div className="flex flex-wrap gap-2">
            {storeStatus?.mailOrderOpen
              ? <Button busy={busy === 'mail'} onClick={() => act('mail', () => storeRepo.setMailOrder(false, storeStatus, mailLaneExists, me), 'Mail order closed')}>Close mail order</Button>
              : <Button variant="primary" busy={busy === 'mail'} disabled={!storeCatalog} title={!storeCatalog ? 'Publish the storefront first' : undefined} onClick={() => act('mail', () => storeRepo.setMailOrder(true, storeStatus, mailLaneExists, me), 'Mail order open')}>Open mail order</Button>}
            {override
              ? <Button variant="quiet" busy={busy === 'override'} onClick={() => act('override', () => storeRepo.setOverride(false, storeStatus, mailLaneExists, me), 'Override ended')}>End override</Button>
              : <Button variant="quiet" busy={busy === 'override'} disabled={!storeCatalog} onClick={() => act('override', () => storeRepo.setOverride(true, storeStatus, mailLaneExists, me), 'Mail order open until the end of today')}>Open mail order anyway, until the end of today</Button>}
          </div>
          <p className="hint mt-3">
            {storeEvent ? <>Mail orders are filed under <Link className="text-blue-ink" href={`/?view=mail_order`}>Mail order</Link> with IDs like <span className="mono">MO_2611_0001</span>, one batch per month.</> : 'The mail-order channel is created on the first publish.'}
            {' '}{hiddenFromMail > 0 && `${hiddenFromMail} active ${hiddenFromMail === 1 ? 'item is' : 'items are'} switched off for mail order in the catalogue.`}
          </p>
        </Panel>

        <Panel pad={false} className="lg:col-span-2">
          <div className="panel-pad pb-3">
            <h2 className="font-bold">Preorders on the storefront</h2>
            <p className="hint">An open, listed preorder batch appears on the storefront between its opening and closing dates. Untick to keep a batch on its Form only.</p>
          </div>
          {preorderBatches.length === 0 ? <div className="panel-pad pt-0"><Empty title="No preorder batches for upcoming events" /></div> : (
            <TableWrap className="rounded-none border-x-0 border-b-0">
              <thead><tr><th>Event</th><th>Batch</th><th>Dates</th><th>On the storefront</th><th>Listed</th></tr></thead>
              <tbody>
                {preorderBatches.map(({ b, e }) => {
                  const lane = docs[`store_${b.id}`];
                  const live = isStorefrontBatch(b, e) && !!lane?.enabled;
                  return (
                    <tr key={b.id}>
                      <td><Link href={`/events/view/?id=${e.id}&tab=batches`} className="font-semibold text-blue-ink">{e.name}</Link><span className="hint block">{formatDate(e.startDate)}</span></td>
                      <td>Batch {b.number} <StatusPill status={b.status} /></td>
                      <td className="whitespace-nowrap">{b.opensAt ? formatDate(b.opensAt) : 'any day'} to {b.closesAt ? formatDate(b.closesAt) : 'no end date'}</td>
                      <td>{live ? <Pill tone="green">Live</Pill> : b.status !== 'open' ? <span className="hint">When the batch opens</span> : b.storefront === false ? <span className="hint">Not listed</span> : <span className="hint">Publish to add</span>}</td>
                      <td><Checkbox label="Listed" checked={b.storefront !== false} disabled={busy === `list-${b.id}`} onChange={(ev) => setListed(b, ev.target.checked)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <ShopText />
      </div>
    </>
  );
}

function ShopText() {
  const { settings } = useData();
  const { me } = useAuth();
  const { run } = useToast();
  const sf = storefrontOf(settings);
  const [t, setT] = useState({ title: sf.shopTitle ?? '', intro: sf.shopIntro ?? '', payment: sf.paymentText ?? '', choices: (sf.paymentChoices ?? []).join('\n') });
  useEffect(() => { const s = storefrontOf(settings); setT({ title: s.shopTitle ?? '', intro: s.shopIntro ?? '', payment: s.paymentText ?? '', choices: (s.paymentChoices ?? []).join('\n') }); }, [settings]);
  const save = () => run(() => settingsRepo.save({
    currency: settings.currency, itemTypes: settings.itemTypes, pickupDeadlineDays: settings.pickupDeadlineDays,
    storefront: { ...sf, shopTitle: t.title.trim(), shopIntro: t.intro.trim(), paymentText: t.payment.trim(), paymentChoices: t.choices.split('\n').map((x) => x.trim()).filter(Boolean) },
  }, me), 'Saved. Publish to show it on the storefront.');
  return (
    <Panel className="lg:col-span-2">
      <h2 className="font-bold mb-3">Shop text</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Title"><Input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} /></Field>
        <Field label="Introduction"><Input value={t.intro} onChange={(e) => setT({ ...t, intro: e.target.value })} /></Field>
        <Field label="Payment instructions" hint="Shown at checkout until a payment gateway is connected. Bank account, QRIS, what to write in the transfer note.">
          <Textarea rows={4} value={t.payment} onChange={(e) => setT({ ...t, payment: e.target.value })} />
        </Field>
        <Field label="Payment choices, one per line" hint="The customer picks one at checkout. It is saved on the order.">
          <Textarea rows={4} value={t.choices} onChange={(e) => setT({ ...t, choices: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3"><Button variant="primary" onClick={save}>Save text</Button></div>
    </Panel>
  );
}
