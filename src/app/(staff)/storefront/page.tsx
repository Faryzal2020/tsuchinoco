'use client';

// Staff view of the storefront: what customers can do right now, the mail-order switch, which
// preorder batches are listed, and everything that shapes the shop page (order, look, banners,
// highlights, text) behind one Save and a live preview. Labels stay short; the "?" tips explain.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { batchRepo, settingsRepo } from '@/lib/repo';
import { storeRepo } from '@/lib/storeActions';
import { fetchManyMedia } from '@/lib/media';
import {
  buildStorefront, groupSections, isStorefrontBatch, MAIL_LANE_ID, mediaIdsForProducts, overrideActive, SORT_KEY_LABELS, sortRulesOf, storeHashFor, storeOrder, storeState, storeThemeOf, STORE_EVENT_CODE,
} from '@/lib/store';
import { storefrontOf } from '@/lib/pricing';
import { PACKING_GRAMS, shippingOf, unweighedWarning, validFee, weightOfKey } from '@/lib/shipping';
import { variantKey, variantsOf } from '@/lib/keys';
import ItemEditorModal from '@/components/catalog/ItemEditorModal';
import { formatDate, formatDateTime } from '@/lib/format';
import { newId } from '@/lib/keys';
import { DEFAULT_STORE_SORT, type Batch, type Event, type Media, type PublicForm, type StoreBlock, type StoreBlockPosition, type StoreCatalog, type StoreSortKey, type StoreSortRule, type StoreTheme, type StorefrontSettings } from '@/types';
import Button from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Empty, Heading, Help, PageHeader, Panel, Pill, StatusPill, TableWrap } from '@/components/ui/Bits';
import ThumbnailInput from '@/components/form/ThumbnailInput';
import Shop from '@/components/shop/Shop';
import { cn } from '@/lib/utils';

export default function StorefrontPage() {
  const { items, events, batches, formsById, publicFormsById, settings, storeCatalog, storeStatus, staff } = useData();
  const { me } = useAuth();
  const { run, toast, error } = useToast();
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
  const hash = useMemo(() => (storeEvent ? storeHashFor({ items, events, batches, formsById, settings, storeEvent, status: storeStatus, staff }) : ''), [items, events, batches, formsById, settings, storeEvent, storeStatus, staff]);
  const changed = !storeCatalog || !storeEvent || hash !== storeCatalog.publishedHash;
  const mailLaneExists = !!publicFormsById.get(MAIL_LANE_ID);
  const override = overrideActive(storeStatus, now);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => { setBusy(key); await run(fn, ok); setBusy(''); };
  const publish = () => act('publish', async () => {
    const r = await storeRepo.publish({ items, events, batches, formsById, settings, current: storeCatalog, status: storeStatus, staff, by: me });
    const warn = unweighedWarning(r.unweighed);
    if (warn) error(`Storefront published. ${warn}`); else toast('Storefront published');
  });

  const preorderBatches = batches
    .filter((b) => b.mode === 'preorder')
    .map((b) => ({ b, e: events.find((x) => x.id === b.eventId) }))
    .filter((x): x is { b: Batch; e: NonNullable<typeof x.e> } => !!x.e && x.e.status === 'upcoming' && x.e.kind !== 'store')
    .sort((a, b) => (a.e.startDate || '').localeCompare(b.e.startDate || '') || a.b.number - b.b.number);

  const setListed = (b: Batch, listed: boolean) => act(`list-${b.id}`, async () => {
    await batchRepo.patch(b.id, { storefront: listed }, me);
    if (b.status === 'open') {
      if (listed) await storeRepo.publish({ items, events, batches: batches.map((x) => (x.id === b.id ? { ...b, storefront: true } : x)), formsById, settings, current: storeCatalog, status: storeStatus, staff, by: me });
      else await storeRepo.mirrorBatch(b.id, false);
    }
  });

  const hiddenFromMail = items.filter((i) => i.active && i.mailOrder === false).length;
  const shopHref = typeof window !== 'undefined' && window.location.hostname === 'admin.tsuchinoco.xyz' ? 'https://tsuchinoco.xyz/shop/' : '/shop/';

  return (
    <>
      <PageHeader title="Storefront" actions={<>
        <Button href={shopHref} target="_blank" rel="noopener noreferrer">Open the shop</Button>
        <Button variant="primary" busy={busy === 'publish'} onClick={publish}>{storeCatalog ? 'Publish changes' : 'Publish storefront'}</Button>
      </>}>
        <div className="flex flex-wrap items-center gap-2">
          {changed ? <Pill tone="yellow">Changed since publish</Pill> : <Pill tone="green">Up to date</Pill>}
          <span className="hint">{storeCatalog ? `Version ${storeCatalog.version} · ${formatDateTime(storeCatalog.publishedAt)} · ${storeCatalog.products.length} products` : 'Never published'}</span>
          <Help text="One shop page for preorders and mail orders. Prices are always live; everything else (items, offerings, batch dates, and the settings on this page) reaches the shop when you publish." />
        </div>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <Heading className="mb-2" tip={<ul className="grid gap-1 list-disc pl-4">{state.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}>Customers can</Heading>
          {state.choices.length === 0 ? (
            <p><Pill>Browse only</Pill> <span className="hint ml-1">Cart and checkout are hidden.</span></p>
          ) : (
            <ul className="grid gap-1.5">
              {state.choices.map((c) => <li key={c.lane.id}><Pill tone={c.lane.kind === 'preorder' ? 'blue' : 'yellow'}>{c.label}</Pill> <span className="hint">{c.detail}</span></li>)}
            </ul>
          )}
        </Panel>

        <Panel>
          <Heading className="mb-2" tip="Regular orders at the mail-order price, shipped after any current event ends. Mail order pauses on its own while a preorder is open or an event is running.">Mail order</Heading>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {storeStatus?.mailOrderOpen ? <Pill tone="green">On</Pill> : <Pill>Off</Pill>}
            {override && <Pill tone="yellow">Open anyway until {new Date(storeStatus!.overrideUntil!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</Pill>}
            {hiddenFromMail > 0 && <span className="hint">{hiddenFromMail} active {hiddenFromMail === 1 ? 'item is' : 'items are'} off for mail order</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {storeStatus?.mailOrderOpen
              ? <Button busy={busy === 'mail'} onClick={() => act('mail', () => storeRepo.setMailOrder(false, storeStatus, mailLaneExists, me), 'Mail order closed')}>Switch off</Button>
              : <Button variant="primary" busy={busy === 'mail'} disabled={!storeCatalog} title={!storeCatalog ? 'Publish the storefront first' : undefined} onClick={() => act('mail', () => storeRepo.setMailOrder(true, storeStatus, mailLaneExists, me), 'Mail order open')}>Switch on</Button>}
            {override
              ? <Button variant="quiet" busy={busy === 'override'} onClick={() => act('override', () => storeRepo.setOverride(false, storeStatus, mailLaneExists, me), 'Override ended')}>End override</Button>
              : <Button variant="quiet" busy={busy === 'override'} disabled={!storeCatalog} onClick={() => act('override', () => storeRepo.setOverride(true, storeStatus, mailLaneExists, me), 'Mail order open until the end of today')}>Open anyway today</Button>}
            <Help text="“Open anyway” takes mail orders until midnight even while a preorder is open or an event is running." />
            {storeEvent && <span className="hint ml-auto">Orders file under <Link className="text-blue-ink" href="/?view=mail_order">Mail order</Link>, one batch per month</span>}
          </div>
        </Panel>

        <Panel pad={false} className="lg:col-span-2">
          <div className="panel-pad pb-3">
            <Heading tip="An open, listed preorder batch appears on the shop between its opening and closing dates. Untick Listed to keep a batch on its Form only.">Preorders on the shop</Heading>
          </div>
          {preorderBatches.length === 0 ? <div className="panel-pad pt-0"><Empty title="No preorder batches for upcoming events" /></div> : (
            <TableWrap className="rounded-none border-x-0 border-b-0">
              <thead><tr><th>Event</th><th>Batch</th><th>Dates</th><th>On the shop</th><th>Listed</th></tr></thead>
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

        <Customise className="lg:col-span-2" />
      </div>
    </>
  );
}

// ---- Customise: one draft of the storefront settings, five tabs, one Save, a live preview ----

type Tab = 'order' | 'look' | 'banners' | 'highlights' | 'text' | 'shipping';
const TABS: { id: Tab; label: string }[] = [
  { id: 'order', label: 'Order' }, { id: 'look', label: 'Look' }, { id: 'banners', label: 'Banners' }, { id: 'highlights', label: 'Highlights' }, { id: 'text', label: 'Text' }, { id: 'shipping', label: 'Shipping' },
];

/** Drops undefined values, which Firestore rejects, and keeps the draft comparable by JSON. */
const tidy = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function Customise({ className }: { className?: string }) {
  const { items, events, batches, formsById, settings, storeStatus, publicPrices, staff } = useData();
  const { me } = useAuth();
  const { run, error } = useToast();
  const base = useMemo(() => tidy(storefrontOf(settings)), [settings]);
  const [draft, setDraft] = useState<StorefrontSettings>(base);
  const baseJson = JSON.stringify(base);
  const draftJson = JSON.stringify(draft);
  const dirty = draftJson !== baseJson;
  // Settings saved elsewhere (or by Save here) flow into the draft unless it has unsaved edits.
  const lastBase = useRef(baseJson);
  useEffect(() => {
    if (lastBase.current === baseJson) return;
    if (JSON.stringify(draft) === lastBase.current) setDraft(base);
    lastBase.current = baseJson;
  }, [base, baseJson, draft]);
  const up = (patch: Partial<StorefrontSettings>) => setDraft((d) => tidy({ ...d, ...patch }));

  const [tab, setTab] = useState<Tab>('order');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (draft.shipping && !/^\d{5}$/.test(draft.shipping.originPostalCode)) { setTab('shipping'); error('The ships-from postcode needs five digits.'); return; }
    setSaving(true);
    await run(() => settingsRepo.save({ currency: settings.currency, itemTypes: settings.itemTypes, pickupDeadlineDays: settings.pickupDeadlineDays, storefront: tidy(draft) }, me), 'Saved. Publish to show it on the shop.');
    setSaving(false);
  };

  // Preview: what the next publish would show, from the draft. Images come through the media cache.
  const [showPreview, setShowPreview] = useState(true);
  const [phone, setPhone] = useState(false);
  const [media, setMedia] = useState<Map<string, Media>>(new Map());
  const mediaIds = mediaIdsForProducts(items, draft).sort().join(',');
  useEffect(() => {
    let alive = true;
    const ids = mediaIds ? mediaIds.split(',') : [];
    fetchManyMedia(ids).then((m) => { if (alive) setMedia(m); }).catch(() => undefined);
    return () => { alive = false; };
  }, [mediaIds]);
  const preview = useMemo(() => {
    if (!showPreview) return null;
    const storeEvent: Event = events.find((e) => e.kind === 'store') ?? {
      id: 'store', name: 'Mail order', code: STORE_EVENT_CODE, kind: 'store', status: 'upcoming', startDate: '', endDate: '', venue: '', pickupDeadlineDays: 0, notes: '', createdAt: 0, updatedAt: 0, updatedBy: '',
    };
    const b = buildStorefront({ items, events, batches, formsById, media, settings: { ...settings, storefront: draft }, storeEvent, status: storeStatus, staff });
    const catalog: StoreCatalog = { ...b.catalog, version: 0, publishedAt: Date.now() };
    const lanes: Record<string, PublicForm> = {};
    for (const l of b.lanes) lanes[l.id] = { id: l.id, ...l.doc, version: 0 };
    return { catalog, lanes };
  }, [showPreview, items, events, batches, formsById, media, settings, draft, storeStatus, staff]);

  return (
    <Panel className={cn('overflow-hidden', className)} pad={false}>
      <div className="panel-pad pb-0">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Heading tip="Everything here is saved to settings and reaches the shop on the next publish. The preview below shows the draft as the shop would render it.">Customise the shop</Heading>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {dirty && <Pill tone="yellow">Unsaved</Pill>}
            {dirty && <Button size="sm" variant="quiet" onClick={() => setDraft(base)}>Discard</Button>}
            <Button size="sm" variant="primary" disabled={!dirty} busy={saving} onClick={save}>Save</Button>
          </div>
        </div>
        <nav className="tabs" aria-label="Customise">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="tab bg-transparent border-x-0 border-t-0 cursor-pointer" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      </div>
      <div className="panel-pad">
        {tab === 'order' && <OrderTab draft={draft} up={up} />}
        {tab === 'look' && <LookTab draft={draft} up={up} />}
        {tab === 'banners' && <BannersTab draft={draft} up={up} />}
        {tab === 'highlights' && <HighlightsTab draft={draft} up={up} />}
        {tab === 'text' && <TextTab draft={draft} up={up} />}
        {tab === 'shipping' && <ShippingTab draft={draft} up={up} />}
      </div>

      <div className="border-t border-line bg-cream-2 px-5 py-2.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Preview</span>
        <Help text="The shop as the next publish would show it, with your unsaved edits. Nothing you click here is remembered or ordered." />
        <div className="ml-auto flex items-center gap-2">
          {showPreview && <Button size="sm" variant={phone ? 'primary' : 'neutral'} onClick={() => setPhone(!phone)} aria-pressed={phone}>Phone width</Button>}
          <Button size="sm" onClick={() => setShowPreview(!showPreview)}>{showPreview ? 'Hide' : 'Show'}</Button>
        </div>
      </div>
      {preview && (
        <div className="bg-cream-2 p-3">
          <div className="mx-auto overflow-hidden rounded-lg border border-line-strong shadow-sm" style={{ maxWidth: phone ? 400 : undefined }}>
            <Shop preview catalog={preview.catalog} status={storeStatus} docs={preview.lanes} prices={publicPrices} onSubmit={async () => { throw new Error('This is a preview.'); }} />
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---- Order ----

const DIR_LABELS: Record<StoreSortKey, [string, string]> = {
  series: ['A to Z', 'Z to A'], type: ['A to Z', 'Z to A'], manager: ['A to Z', 'Z to A'], artist: ['A to Z', 'Z to A'], name: ['A to Z', 'Z to A'],
  price: ['Low to high', 'High to low'], added: ['Oldest first', 'Newest first'],
};
const SORT_KEYS = Object.keys(SORT_KEY_LABELS) as StoreSortKey[];

function OrderTab({ draft, up }: { draft: StorefrontSettings; up: (p: Partial<StorefrontSettings>) => void }) {
  const { items, staff } = useData();
  const rules = draft.sort && draft.sort.length > 0 ? draft.sort : DEFAULT_STORE_SORT;
  const set = (next: StoreSortRule[]) => up({ sort: next });
  const used = new Set(rules.map((r) => r.key));
  const free = SORT_KEYS.filter((k) => !used.has(k));
  const move = (i: number, d: -1 | 1) => { const n = [...rules]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; set(n); };
  const ordered = useMemo(() => {
    const highlighted = new Set(draft.highlights);
    return storeOrder(items.filter((i) => i.active && !highlighted.has(i.id)), staff, sortRulesOf({ sort: rules }));
  }, [items, staff, rules, draft.highlights]);
  const sections = draft.groupHeadings ? groupSections(ordered, sortRulesOf({ sort: rules }), staff) : [];
  const headingAt = new Map(sections.map((s) => [s.keys[0], s.title]));

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        <Heading level={3} className="mb-2" tip="Levels apply in order: the first level groups the list, the next breaks ties inside each group, and so on. Items without a value for a level (no series, no artist) go last. Highlighted items are not affected; they sit at the top.">Sort the main list by</Heading>
        <ol className="grid gap-2">
          {rules.map((r, i) => (
            <li key={r.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-cream px-3 py-2">
              <span className="eyebrow w-14">{i === 0 ? 'First' : i === 1 ? 'Then' : 'Then'}</span>
              <Select small className="w-44" value={r.key} onChange={(e) => { const n = [...rules]; n[i] = { ...r, key: e.target.value as StoreSortKey }; set(n); }}>
                {SORT_KEYS.filter((k) => k === r.key || !used.has(k)).map((k) => <option key={k} value={k}>{SORT_KEY_LABELS[k]}</option>)}
              </Select>
              <Button size="sm" onClick={() => { const n = [...rules]; n[i] = { ...r, dir: r.dir === 'asc' ? 'desc' : 'asc' }; set(n); }} title="Reverse this level">
                {DIR_LABELS[r.key][r.dir === 'asc' ? 0 : 1]}
              </Button>
              <span className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="quiet" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">Up</Button>
                <Button size="sm" variant="quiet" disabled={i === rules.length - 1} onClick={() => move(i, 1)} aria-label="Move down">Down</Button>
                <Button size="sm" variant="quiet" disabled={rules.length === 1} onClick={() => set(rules.filter((_, j) => j !== i))}>Remove</Button>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {free.length > 0 && <Button size="sm" onClick={() => set([...rules, { key: free[0], dir: 'asc' }])}>Add a level</Button>}
          <Button size="sm" variant="quiet" onClick={() => set(DEFAULT_STORE_SORT)}>Reset</Button>
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer ml-auto">
            <input type="checkbox" className="checkbox" checked={!!draft.groupHeadings} onChange={(e) => up({ groupHeadings: e.target.checked })} />
            Headings per group
            <Help text="Adds a heading to the main list each time the first level changes, e.g. one per series. Headings show that level’s value, so with Product manager first the managers’ names appear on the public shop. Price and date levels make no headings." />
          </label>
        </div>
      </div>
      <div>
        <Heading level={3} className="mb-2" tip="The main list in the order customers will see it, from the active catalogue. Highlighted items are left out.">Result</Heading>
        <ol className="max-h-72 overflow-auto rounded-lg border border-line bg-white text-sm divide-y divide-line">
          {ordered.map((i) => (
            <React.Fragment key={i.id}>
              {headingAt.has(i.id) && <li className="bg-cream-2 px-3 py-1 text-xs font-bold text-ink-2">{headingAt.get(i.id)}</li>}
              <li className="px-3 py-1.5 flex items-baseline gap-2 min-w-0"><span className="truncate">{i.name}</span><span className="hint ml-auto whitespace-nowrap">{[i.category, i.kind === 'bundle' ? 'bundle' : i.type].filter(Boolean).join(' · ')}</span></li>
            </React.Fragment>
          ))}
          {ordered.length === 0 && <li className="px-3 py-2 hint">No active items.</li>}
        </ol>
      </div>
    </div>
  );
}

// ---- Look ----

const SIZE_OPTS: { v: StoreTheme['titleSize']; l: string }[] = [{ v: 'sm', l: 'Small' }, { v: 'md', l: 'Regular' }, { v: 'lg', l: 'Large' }, { v: 'xl', l: 'Extra large' }];

function ColorField({ label, value, onChange, tip }: { label: string; value: string; onChange: (v: string) => void; tip?: string }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div>
      <span className="label flex items-center gap-1.5">{label}{tip && <Help text={tip} />}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={valid ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-[30px] w-9 cursor-pointer rounded-md border border-line-strong bg-white p-0.5" aria-label={`${label} colour`} />
        <Input small className="w-24 font-mono" value={value} onChange={(e) => onChange(e.target.value.trim())} aria-label={`${label} hex`} />
      </div>
    </div>
  );
}

function LookTab({ draft, up }: { draft: StorefrontSettings; up: (p: Partial<StorefrontSettings>) => void }) {
  const t = storeThemeOf(draft);
  const upT = (patch: Partial<StoreTheme>) => up({ theme: { ...(draft.theme ?? {}), ...patch } });
  const drop = (key: keyof StoreTheme) => { const next = { ...(draft.theme ?? {}) }; delete next[key]; up({ theme: next }); };
  return (
    <div className="grid gap-6">
      <div>
        <Heading level={3} className="mb-2" tip="Hex colours. The shop derives its soft tints (chips, active states, muted text) from these, so a few colours restyle the whole page.">Colours</Heading>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
          <ColorField label="Background" value={t.background} onChange={(v) => upT({ background: v })} tip="The page behind the cards. Covered by a wallpaper if you set one." />
          <ColorField label="Cards" value={t.surface} onChange={(v) => upT({ surface: v })} tip="Item cards, checkout and the filters box." />
          <ColorField label="Text" value={t.text} onChange={(v) => upT({ text: v })} />
          <ColorField label="Borders" value={t.border} onChange={(v) => upT({ border: v })} tip="Card and input outlines." />
          <ColorField label="Accent" value={t.accent} onChange={(v) => upT({ accent: v })} tip="Links, focus rings, savings and the preorder status tint." />
          <ColorField label="Button" value={t.button} onChange={(v) => upT({ button: v })} tip="Add to cart and the checkout button." />
          <ColorField label="Button text" value={t.buttonText} onChange={(v) => upT({ buttonText: v })} />
          <ColorField label="Highlight" value={t.highlight} onChange={(v) => upT({ highlight: v })} tip="The Highlighted section’s underline, active filter chips and the mail-order status tint." />
          <div>
            <span className="label flex items-center gap-1.5">Price<Help text="Leave on “Same as text” unless prices should stand out in their own colour." /></span>
            {t.priceColor
              ? <div className="flex items-center gap-2"><input type="color" value={t.priceColor} onChange={(e) => upT({ priceColor: e.target.value })} className="h-[30px] w-9 cursor-pointer rounded-md border border-line-strong bg-white p-0.5" aria-label="Price colour" /><Button size="sm" variant="quiet" onClick={() => drop('priceColor')}>Same as text</Button></div>
              : <Button size="sm" onClick={() => upT({ priceColor: t.text })}>Pick a colour</Button>}
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <Heading level={3} className="mb-2" tip="A picture behind the whole page. “Fill” scales it to cover the screen; “Tile” repeats it at its own size, good for patterns.">Wallpaper</Heading>
          <div className="flex flex-wrap items-center gap-3">
            <ThumbnailInput kind="image" value={t.wallpaperId} onChange={(id) => (id ? upT({ wallpaperId: id }) : drop('wallpaperId'))} />
            {t.wallpaperId && (
              <Select small className="w-28" value={t.wallpaperMode} onChange={(e) => upT({ wallpaperMode: e.target.value as StoreTheme['wallpaperMode'] })}>
                <option value="cover">Fill</option><option value="tile">Tile</option>
              </Select>
            )}
          </div>
        </div>
        <div>
          <Heading level={3} className="mb-2">Shapes</Heading>
          <div className="grid gap-3 grid-cols-2">
            <Field label="Corners"><Select small value={t.radius} onChange={(e) => upT({ radius: e.target.value as StoreTheme['radius'] })}><option value="sharp">Sharp</option><option value="soft">Soft</option><option value="round">Round</option></Select></Field>
            <Field label="Border width"><Select small value={t.borderWidth} onChange={(e) => upT({ borderWidth: Number(e.target.value) as StoreTheme['borderWidth'] })}><option value={0}>None</option><option value={1}>Thin</option><option value={2}>Medium</option><option value={3}>Thick</option></Select></Field>
            <Field label="Buttons"><Select small value={t.buttonStyle} onChange={(e) => upT({ buttonStyle: e.target.value as StoreTheme['buttonStyle'] })}><option value="tactile">Tactile</option><option value="flat">Flat</option><option value="outline">Outline</option><option value="pill">Pill</option></Select></Field>
            <Field label="Font"><Select small value={t.font} onChange={(e) => upT({ font: e.target.value as StoreTheme['font'] })}><option value="sans">Sans</option><option value="serif">Serif</option><option value="rounded">Rounded</option><option value="mono">Mono</option></Select></Field>
          </div>
        </div>
      </div>

      <div>
        <Heading level={3} className="mb-2" tip="Sizes on each item card. Phones shrink titles and prices a little on their own.">Type sizes</Heading>
        <div className="grid gap-3 grid-cols-3 max-w-lg">
          <Field label="Title"><Select small value={t.titleSize} onChange={(e) => upT({ titleSize: e.target.value as StoreTheme['titleSize'] })}>{SIZE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</Select></Field>
          <Field label="Price"><Select small value={t.priceSize} onChange={(e) => upT({ priceSize: e.target.value as StoreTheme['priceSize'] })}>{SIZE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</Select></Field>
          <Field label="Description"><Select small value={t.descSize} onChange={(e) => upT({ descSize: e.target.value as StoreTheme['descSize'] })}>{SIZE_OPTS.slice(0, 3).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</Select></Field>
        </div>
      </div>
      <div><Button size="sm" variant="quiet" onClick={() => up({ theme: {} })}>Reset the look to defaults</Button></div>
    </div>
  );
}

// ---- Banners ----

const POSITIONS: { v: StoreBlockPosition; l: string }[] = [{ v: 'top', l: 'Under the title' }, { v: 'middle', l: 'After highlights' }, { v: 'bottom', l: 'After the list' }];

function BannersTab({ draft, up }: { draft: StorefrontSettings; up: (p: Partial<StorefrontSettings>) => void }) {
  const blocks = draft.blocks ?? [];
  const set = (next: StoreBlock[]) => up({ blocks: next });
  const patch = (i: number, p: Partial<StoreBlock>) => { const n = [...blocks]; n[i] = { ...n[i], ...p } as StoreBlock; set(n); };
  const move = (i: number, d: -1 | 1) => { const n = [...blocks]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; set(n); };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Heading level={3} tip="Banners are wide images, resized to 1600 px. Separators are a line or a titled break. Blocks at the same position show in this order.">Banners and separators</Heading>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => set([...blocks, { id: newId(8), type: 'banner', imageId: '', position: 'top' }])}>Add a banner</Button>
          <Button size="sm" onClick={() => set([...blocks, { id: newId(8), type: 'separator', style: 'line', position: 'middle' }])}>Add a separator</Button>
        </div>
      </div>
      {blocks.length === 0 && <p className="hint">None yet. The shop shows the title, the item list and nothing in between.</p>}
      <ul className="grid gap-2">
        {blocks.map((b, i) => (
          <li key={b.id} className="rounded-lg border border-line bg-cream px-3 py-2 grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={b.type === 'banner' ? 'blue' : 'neutral'}>{b.type === 'banner' ? 'Banner' : 'Separator'}</Pill>
              <Select small className="w-44" value={b.position} onChange={(e) => patch(i, { position: e.target.value as StoreBlockPosition })}>{POSITIONS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</Select>
              <span className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="quiet" disabled={i === 0} onClick={() => move(i, -1)}>Up</Button>
                <Button size="sm" variant="quiet" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>Down</Button>
                <Button size="sm" variant="quiet" onClick={() => set(blocks.filter((_, j) => j !== i))}>Remove</Button>
              </span>
            </div>
            {b.type === 'banner' ? (
              <div className="flex flex-wrap items-start gap-3">
                <ThumbnailInput kind="image" value={b.imageId || undefined} onChange={(id) => patch(i, { imageId: id ?? '' })} />
                <div className="grid gap-2 flex-1 min-w-[220px] sm:grid-cols-2">
                  <Input small placeholder="Link (optional), https://…" value={b.href ?? ''} onChange={(e) => { const v = e.target.value; const n = [...blocks]; const { href: _h, ...rest } = b; void _h; n[i] = v ? { ...b, href: v } : (rest as StoreBlock); set(n); }} aria-label="Banner link" />
                  <Input small placeholder="Describe the picture (for screen readers)" value={b.alt ?? ''} onChange={(e) => patch(i, { alt: e.target.value })} aria-label="Banner description" />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Input small className="w-64" placeholder="Title (optional)" value={b.title ?? ''} onChange={(e) => patch(i, { title: e.target.value })} aria-label="Separator title" />
                <Select small className="w-32" value={b.style} onChange={(e) => patch(i, { style: e.target.value as 'line' | 'space' })}><option value="line">Line</option><option value="space">Space only</option></Select>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Highlights ----

function HighlightsTab({ draft, up }: { draft: StorefrontSettings; up: (p: Partial<StorefrontSettings>) => void }) {
  const { items, staff } = useData();
  const [q, setQ] = useState('');
  const active = useMemo(() => storeOrder(items.filter((i) => i.active), staff, sortRulesOf(draft)), [items, staff, draft]);
  const on = new Set((draft.highlights ?? []).filter((id) => active.some((i) => i.id === id)));
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = active.filter((i) => on.has(i.id) || words.every((w) => [i.name, i.category, i.artist, i.type].join(' ').toLowerCase().includes(w)));
  const list = [...shown.filter((i) => on.has(i.id)), ...shown.filter((i) => !on.has(i.id))];
  const toggle = (id: string, yes: boolean) => {
    const next = new Set(on);
    if (yes) next.add(id); else next.delete(id);
    up({ highlights: active.filter((i) => next.has(i.id)).map((i) => i.id) });
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Heading level={3} tip="Highlighted items get their own section at the top of the shop and are left out of the main list. They keep the sort order among themselves.">Highlighted items</Heading>
        <Input className="max-w-xs" small type="search" placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an item to highlight" />
        <span className="hint">{on.size === 0 ? 'None' : `${on.size} highlighted`}</span>
      </div>
      {active.length === 0 ? <p className="hint">No active items in the catalogue.</p> : (
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 max-h-72 overflow-auto py-1">
          {list.map((i) => (
            <li key={i.id} className="min-w-0">
              <label className="inline-flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="checkbox mt-0.5 shrink-0" checked={on.has(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} />
                <span>{i.name}{i.category && <span className="hint"> · {i.category}</span>}</span>
              </label>
            </li>
          ))}
          {list.length === 0 && <li className="hint">No items match.</li>}
        </ul>
      )}
    </div>
  );
}

// ---- Text ----

function TextTab({ draft, up }: { draft: StorefrontSettings; up: (p: Partial<StorefrontSettings>) => void }) {
  const parse = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const [choices, setChoices] = useState((draft.paymentChoices ?? []).join('\n'));
  const saved = JSON.stringify(draft.paymentChoices ?? []);
  useEffect(() => { if (JSON.stringify(parse(choices)) !== saved) setChoices(JSON.parse(saved).join('\n')); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Title"><Input value={draft.shopTitle ?? ''} onChange={(e) => up({ shopTitle: e.target.value })} /></Field>
      <Field label="Introduction"><Input value={draft.shopIntro ?? ''} onChange={(e) => up({ shopIntro: e.target.value })} /></Field>
      <div>
        <span className="label flex items-center gap-1.5">Payment instructions<Help text="Shown at checkout until a payment gateway is connected: bank account, QRIS, what to write in the transfer note." /></span>
        <Textarea rows={4} value={draft.paymentText ?? ''} onChange={(e) => up({ paymentText: e.target.value })} aria-label="Payment instructions" />
      </div>
      <div>
        <span className="label flex items-center gap-1.5">Payment choices<Help text="One per line. The customer picks one at checkout and it is saved on the order." /></span>
        <Textarea rows={4} value={choices} onChange={(e) => { setChoices(e.target.value); up({ paymentChoices: parse(e.target.value) }); }} aria-label="Payment choices, one per line" />
      </div>
    </div>
  );
}

// ---- Shipping ----

function ShippingTab({ draft, up }: { draft: StorefrontSettings; up: (p: Partial<StorefrontSettings>) => void }) {
  const { items, itemsById, settings } = useData();
  const ship = shippingOf({ storefront: draft });
  const set = (patch: Partial<typeof ship>) => up({ shipping: { ...ship, ...patch } });
  const fee = (v: string) => validFee(v === '' ? 0 : Number(v)) ?? 0;
  const [editing, setEditing] = useState<string | null>(null);
  // Active items whose units (or one of their active variants) have no weight, so shipping cannot price them.
  const unweighed = useMemo(() => items
    .filter((i) => i.active)
    .map((i) => {
      const keys = i.kind === 'bundle' ? [i.id] : variantsOf(i).filter((v) => v.active).map((v) => variantKey(i.id, v.id));
      const missing = keys.filter((k) => !weightOfKey(k, itemsById));
      return { item: i, missing: missing.length, total: keys.length };
    })
    .filter((x) => x.missing > 0), [items, itemsById]);
  const postcodeOk = /^\d{5}$/.test(ship.originPostalCode);

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="grid gap-3 content-start">
        <Heading level={3} tip="Lion Parcel prices come from Biteship at checkout and are locked in with the order. Booth pickups pay none of this.">Shipped orders</Heading>
        <Field label="Ships from (postcode)" hint={postcodeOk ? 'Bojonggede, Bogor is 16920' : 'Needs five digits'}>
          <Input inputMode="numeric" maxLength={5} className="w-28" value={ship.originPostalCode} onChange={(e) => set({ originPostalCode: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
        </Field>
        <div className="grid gap-3 grid-cols-2">
          <Field label={`Handling fee (${settings.currency})`} hint="Per shipped order">
            <Input type="number" min={0} step={1000} value={ship.handlingFee} onChange={(e) => set({ handlingFee: fee(e.target.value) })} />
          </Field>
          <Field label={`Packaging fee (${settings.currency})`} hint="Per shipped order">
            <Input type="number" min={0} step={1000} value={ship.packagingFee} onChange={(e) => set({ packagingFee: fee(e.target.value) })} />
          </Field>
        </div>
        <p className="hint">Each form can set its own fees in its settings; blank there means these. Parcels add {PACKING_GRAMS} g for packing. Lion charges whole kilograms and rounds up above 0,3 kg (1.300 g is 1 kg, 1.310 g is 2 kg).</p>
      </div>
      <div>
        <Heading level={3} className="mb-2" tip="Weights are set per item, and per variant where they differ, in the catalogue. Bundles without their own weight add up their components. Click an item to edit it.">
          Items without a weight
        </Heading>
        {unweighed.length === 0 ? (
          <p className="hint">Every active item has a weight.</p>
        ) : (
          <>
            <p className="hint mb-2">{unweighed.length} active {unweighed.length === 1 ? 'item needs' : 'items need'} a weight before shipping can price {unweighed.length === 1 ? 'it' : 'them'}. Until then each unit counts as {PACKING_GRAMS} g and the order is flagged.</p>
            <ul className="max-h-72 overflow-auto rounded-lg border border-line bg-white text-sm divide-y divide-line">
              {unweighed.map(({ item, missing, total }) => (
                <li key={item.id}>
                  <button type="button" className="w-full text-left px-3 py-1.5 flex items-baseline gap-2 min-w-0 bg-transparent border-0 cursor-pointer hover:bg-cream" onClick={() => setEditing(item.id)}>
                    <span className="truncate">{item.name}</span>
                    <span className="hint ml-auto whitespace-nowrap">{item.kind === 'bundle' ? 'bundle' : total > 1 ? `${missing} of ${total} variants` : item.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <ItemEditorModal itemId={editing} open={!!editing} onClose={() => setEditing(null)} />
    </div>
  );
}
