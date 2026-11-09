// Storefront logic with no Firestore access, so the staff app, the customer page and the
// localhost sandbox all share it. Writes live in storeActions.ts.
//
// The storefront is one catalogue (publicStore/catalog) plus one "lane" per place an order can go.
// Each lane is a publicForms document, so the existing submission rules validate storefront orders
// exactly like Forms orders: `store_<batchId>` for an open preorder batch, `store_mail` for mail order.
import type {
  Batch, Event, FormDoc, Item, Media, OrderType, PublicForm, PublicPrices, PublishedStoreBlock, Settings, Staff, StoreBlock, StoreCatalog, StoreLaneInfo, StoreProduct, StoreSortKey, StoreSortRule, StoreStatus, StoreTheme, StorefrontSettings,
} from '@/types';
import { DEFAULT_STORE_SORT, DEFAULT_STORE_THEME } from '@/types';
import { variantKey, variantsOf, variantOf } from './keys';
import { catalogPrice, orderTypeForBatch, quote, storefrontOf, type Quote } from './pricing';
import { acceptWindow, DEFAULT_THEME, eventCode, offeringKey, pickupDaysFor, windowState } from './forms';

export const MAIL_LANE_ID = 'store_mail';
/** Placeholder batch id on the mail lane; the importer files each mail order under its month's batch. */
export const MAIL_LANE_BATCH = 'store-mail';
export const STORE_EVENT_CODE = 'MO';
export const laneIdFor = (batchId: string) => `store_${batchId}`;
export const isStoreLaneId = (formId: string) => formId.startsWith('store_');

/** Month batch of the mail-order channel: id `mo_2611`, number 2611, so order IDs read MO_2611_0042. */
export function monthBatchFor(ms: number): { id: string; number: number } {
  const d = new Date(ms);
  const yymm = (d.getFullYear() % 100) * 100 + (d.getMonth() + 1);
  return { id: `mo_${String(yymm).padStart(4, '0')}`, number: yymm };
}

export const isStorefrontBatch = (b: Batch, e: Event | undefined): boolean =>
  !!e && e.kind !== 'store' && e.status === 'upcoming' && b.mode === 'preorder' && b.status === 'open' && b.storefront !== false;

const mediaSrc = (media: Map<string, Media>, id?: string) => {
  if (!id) return undefined;
  const m = media.get(id);
  return m?.url || m?.dataUrl;
};

export const SORT_KEY_LABELS: Record<StoreSortKey, string> = {
  series: 'Series', type: 'Type', manager: 'Product manager', artist: 'Artist', name: 'Name', price: 'Price', added: 'Date added',
};

/** Keeps only well-formed rules; an empty list falls back to the default order. */
export function sortRulesOf(sf: Pick<StorefrontSettings, 'sort'>): StoreSortRule[] {
  const ok = (sf.sort ?? []).filter((r) => r && r.key in SORT_KEY_LABELS && (r.dir === 'asc' || r.dir === 'desc'));
  return ok.length > 0 ? ok : DEFAULT_STORE_SORT;
}

/** The theme with every default filled in, so the shop can rely on each field. */
export const storeThemeOf = (sf: Pick<StorefrontSettings, 'theme'>): StoreTheme => ({ ...DEFAULT_STORE_THEME, ...(sf.theme ?? {}) });

/** The text value one sort level groups by. Empty means "unknown", which always sorts last. */
export function sortValue(i: Item, key: StoreSortKey, managerName: (i: Item) => string): string {
  switch (key) {
    case 'series': return (i.category ?? '').trim();
    case 'type': return i.kind === 'bundle' ? 'Bundle' : (i.type ?? '').trim();
    case 'manager': return managerName(i);
    case 'artist': return (i.artist ?? '').trim();
    case 'name': return i.name;
    case 'price': return '';
    case 'added': return '';
  }
}

/**
 * Storefront order, from the staff's sort levels: each level compares its value, blanks last whatever
 * the direction, and ties fall through to the next level, then to the name. The order is only an
 * order; manager names stay out of the public catalogue.
 */
export function storeOrder(items: Item[], staff: Pick<Staff, 'id' | 'displayName'>[] = [], rules: StoreSortRule[] = DEFAULT_STORE_SORT): Item[] {
  const coll = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const names = new Map(staff.map((s) => [s.id, s.displayName]));
  // Same name the catalogue page shows: the staff member's display name, else the imported name.
  const manager = (i: Item) => (names.get(i.managerId) || i.managerName || i.managerId || '').trim();
  const level = (a: Item, b: Item, r: StoreSortRule): number => {
    const sign = r.dir === 'desc' ? -1 : 1;
    if (r.key === 'price') return sign * (a.price - b.price);
    if (r.key === 'added') return sign * ((a.createdAt ?? 0) - (b.createdAt ?? 0));
    const va = sortValue(a, r.key, manager), vb = sortValue(b, r.key, manager);
    return (Number(!va) - Number(!vb)) || sign * coll.compare(va, vb);
  };
  return [...items].sort((a, b) => {
    for (const r of rules) { const c = level(a, b, r); if (c) return c; }
    return coll.compare(a.name, b.name);
  });
}

/** Headings for the main list: one per run of the first sort level. Only text levels make headings. */
export function groupSections(items: Item[], rules: StoreSortRule[], staff: Pick<Staff, 'id' | 'displayName'>[] = []): { title: string; keys: string[] }[] {
  const first = rules[0];
  if (!first || first.key === 'price' || first.key === 'added') return [];
  const names = new Map(staff.map((s) => [s.id, s.displayName]));
  const manager = (i: Item) => (names.get(i.managerId) || i.managerName || i.managerId || '').trim();
  const out: { title: string; keys: string[] }[] = [];
  for (const i of items) {
    const title = sortValue(i, first.key, manager) || 'Other';
    const last = out[out.length - 1];
    if (last && last.title === title) last.keys.push(i.id); else out.push({ title, keys: [i.id] });
  }
  return out.length > 1 ? out : [];
}

/** Every active item, with its active variants, in storefront order (see storeOrder). */
export function buildProducts(items: Item[], media: Map<string, Media>, staff?: Pick<Staff, 'id' | 'displayName'>[], rules?: StoreSortRule[]): StoreProduct[] {
  return storeOrder(items.filter((i) => i.active), staff, rules)
    .map((i) => ({
      itemId: i.id, name: i.name, kind: i.kind, type: i.kind === 'bundle' ? 'bundle' : i.type,
      category: i.category || undefined, artist: i.artist || undefined, thumb: mediaSrc(media, i.thumbnailId),
      variants: (i.kind === 'bundle' ? [{ id: '', name: '' }] : variantsOf(i).filter((v) => v.active)).map((v) => {
        const key = i.kind === 'bundle' ? i.id : variantKey(i.id, v.id);
        const p = catalogPrice(i, key);
        return { key, name: v.name, thumb: mediaSrc(media, i.kind === 'bundle' ? undefined : variantOf(i, v.id)?.thumbnailId), fallback: { po: p.po, ots: p.ots, ...(p.discountPercent ? { discountPercent: p.discountPercent } : {}) } };
      }),
    }))
    .filter((p) => p.variants.length > 0);
}

/** Media a publish needs: item and variant thumbnails, the wallpaper and the banner images. */
export const mediaIdsForProducts = (items: Item[], sf?: Pick<StorefrontSettings, 'theme' | 'blocks'>): string[] => {
  const ids = new Set<string>();
  for (const i of items) {
    if (!i.active) continue;
    if (i.thumbnailId) ids.add(i.thumbnailId);
    for (const v of i.variants ?? []) if (v.thumbnailId) ids.add(v.thumbnailId);
  }
  if (sf?.theme?.wallpaperId) ids.add(sf.theme.wallpaperId);
  for (const b of sf?.blocks ?? []) if (b.type === 'banner' && b.imageId) ids.add(b.imageId);
  return [...ids];
};

/** Blocks as the shop reads them; a banner whose image is missing is dropped. */
export function publishBlocks(blocks: StoreBlock[] | undefined, media: Map<string, Media>): PublishedStoreBlock[] {
  const out: PublishedStoreBlock[] = [];
  for (const b of blocks ?? []) {
    if (b.type === 'separator') { out.push(b); continue; }
    const src = mediaSrc(media, b.imageId);
    if (!src) continue;
    const { imageId: _id, ...rest } = b;
    void _id;
    out.push({ ...rest, src });
  }
  return out;
}

function laneDoc(id: string, eventId: string, batchId: string, mode: Batch['mode'], title: string, items: PublicForm['items'], settings: Settings, pickupDays: string[], extra: Partial<PublicForm>, version: number, enabled: boolean): Omit<PublicForm, 'id'> {
  return {
    formId: id, eventId, batchId, enabled, mode, title, theme: DEFAULT_THEME, labels: {},
    settings: { pickupDays, maxQtyPerLine: 20, requirePhone: true, requireEmail: true, thankYouMessage: '', closedMessage: '' },
    currency: settings.currency, blocks: [], items, maxQtyPerLine: 20, publishedAt: Date.now(), version, ...extra,
  };
}

export interface StoreBuild {
  catalog: Omit<StoreCatalog, 'version' | 'publishedAt'>;
  lanes: { id: string; doc: Omit<PublicForm, 'id' | 'version'> }[];
}

/** Everything a storefront publish writes, from the staff app's data. */
export function buildStorefront(input: {
  items: Item[]; events: Event[]; batches: Batch[]; formsById: Map<string, FormDoc>; media: Map<string, Media>;
  settings: Settings; storeEvent: Event; status: StoreStatus | null;
  /** For the manager order; without it items fall back to their imported manager name. */
  staff?: Pick<Staff, 'id' | 'displayName'>[];
}): StoreBuild {
  const { items, events, batches, formsById, media, settings, storeEvent, status, staff } = input;
  const sf = storefrontOf(settings);
  const rules = sortRulesOf(sf);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const products = buildProducts(items, media, staff, rules);
  const lanes: StoreBuild['lanes'] = [];
  const laneInfo: StoreLaneInfo[] = [];

  for (const b of batches) {
    const e = eventById.get(b.eventId);
    if (!e || !isStorefrontBatch(b, e)) continue;
    const q = (item: Item, key: string, override?: number) => quote(catalogPrice(item, key), orderTypeForBatch(b), sf.priceBasis, override);
    const map: PublicForm['items'] = {};
    for (const entry of b.offering) {
      const item = itemsById.get(entry.itemId);
      if (!item || !item.active) continue;
      const key = offeringKey(entry);
      map[key] = { name: item.name, variantName: variantOf(item, entry.variantId)?.name ?? '', price: q(item, key, entry.overridePrice).unitPrice, kind: item.kind };
    }
    if (Object.keys(map).length === 0) continue;
    const id = laneIdFor(b.id);
    const pickupDays = formsById.get(b.id)?.settings.pickupDays ?? pickupDaysFor(e);
    const overrides = Object.fromEntries(b.offering.filter((x) => typeof x.overridePrice === 'number').map((x) => [offeringKey(x), x.overridePrice as number]));
    lanes.push({ id, doc: laneDoc(id, e.id, b.id, b.mode, `${e.name} preorder`, map, settings, pickupDays, { ...acceptWindow(b), overrides }, 0, true) });
    laneInfo.push({ id, kind: 'preorder', eventName: e.name, eventCode: eventCode(e), startDate: e.startDate, endDate: e.endDate, pickupDays, closesAt: b.closesAt });
  }

  // Mail order: every active item that is not switched off for mail order.
  const mailMap: PublicForm['items'] = {};
  for (const item of items) {
    if (!item.active || item.mailOrder === false) continue;
    const keys = item.kind === 'bundle' ? [item.id] : variantsOf(item).filter((v) => v.active).map((v) => variantKey(item.id, v.id));
    for (const key of keys) {
      mailMap[key] = { name: item.name, variantName: key.includes(':') ? variantOf(item, key.split(':')[1])?.name ?? '' : '', price: quote(catalogPrice(item, key), 'mail_order', sf.priceBasis).unitPrice, kind: item.kind };
    }
  }
  const mailEnabled = !!status && (status.mailOrderOpen || overrideActive(status));
  lanes.push({ id: MAIL_LANE_ID, doc: laneDoc(MAIL_LANE_ID, storeEvent.id, MAIL_LANE_BATCH, 'post', 'Mail order', mailMap, settings, [], {}, 0, mailEnabled) });
  laneInfo.push({ id: MAIL_LANE_ID, kind: 'mail_order', eventName: 'Mail order', eventCode: STORE_EVENT_CODE, startDate: '', endDate: '', pickupDays: [], closesAt: '' });

  const eventDays = events
    .filter((e) => e.kind !== 'store' && e.status === 'upcoming' && e.startDate)
    .map((e) => ({ name: e.name, code: eventCode(e), from: new Date(`${e.startDate}T00:00:00`).getTime(), until: new Date(`${e.endDate || e.startDate}T23:59:59.999`).getTime() }));

  const highlights = highlightsFor(products, sf.highlights);
  // Headings cover the main list only; highlighted items sit in their own section above it.
  const listed = products.filter((p) => !highlights.includes(p.itemId)).map((p) => itemsById.get(p.itemId)).filter((i): i is Item => !!i);
  const theme = storeThemeOf(sf);
  const wallpaper = mediaSrc(media, theme.wallpaperId);
  const { wallpaperId: _w, ...themeOut } = theme;
  void _w;
  const catalog: StoreBuild['catalog'] = {
    title: sf.shopTitle ?? '', intro: sf.shopIntro ?? '', currency: settings.currency,
    products, lanes: laneInfo, eventDays, sections: sf.groupHeadings ? groupSections(listed, rules, staff) : [], highlights,
    theme: wallpaper ? { ...themeOut, wallpaper } : themeOut, blocks: publishBlocks(sf.blocks, media),
    paymentText: sf.paymentText ?? '', paymentChoices: sf.paymentChoices ?? [],
    requirePhone: true, requireEmail: true, publishedHash: '',
  };
  return { catalog, lanes };
}

/** Highlighted item ids that are on the storefront, in storefront order. */
export function highlightsFor(products: StoreProduct[], ids: string[] | undefined): string[] {
  const on = new Set(ids ?? []);
  return products.filter((p) => on.has(p.itemId)).map((p) => p.itemId);
}

/**
 * Hash of what a publish would write, independent of where images are stored: thumbnails count by
 * media id. Publish stores it; the Storefront page compares it to show "changed since publish".
 */
export function storeHashFor(input: Omit<Parameters<typeof buildStorefront>[0], 'media'>): string {
  const stub = new Map(mediaIdsForProducts(input.items, storefrontOf(input.settings)).map((id) => [id, { url: id } as Media]));
  const b = buildStorefront({ ...input, media: stub });
  return storeHash(b.catalog, b.lanes);
}

/** Stable hash of what a publish would write, for "changed since publish". Prices are live and left out. */
export function storeHash(catalog: StoreBuild['catalog'], lanes: StoreBuild['lanes']): string {
  const products = catalog.products.map((p) => [p.itemId, p.name, p.type, p.category, p.artist, p.thumb ?? '', p.variants.map((v) => [v.key, v.name, v.thumb ?? ''])]);
  const ls = lanes.map((l) => [l.id, l.doc.batchId, Object.keys(l.doc.items).sort(), l.doc.acceptFrom, l.doc.acceptUntil, l.doc.overrides, l.doc.settings.pickupDays]);
  const s = JSON.stringify([catalog.title, catalog.intro, catalog.paymentText, catalog.paymentChoices, products, ls, catalog.eventDays, catalog.highlights, catalog.sections, catalog.theme, catalog.blocks]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const overrideActive = (status: Pick<StoreStatus, 'overrideUntil'> | null | undefined, now = Date.now()): boolean =>
  typeof status?.overrideUntil === 'number' && now <= status.overrideUntil;

/** End of the current local day, for "Open mail order anyway until the end of today". */
export const endOfToday = (now = Date.now()): number => { const d = new Date(now); d.setHours(23, 59, 59, 999); return d.getTime(); };

export interface StoreChoice {
  lane: StoreLaneInfo;
  doc: PublicForm;
  label: string;
  detail: string;
}

export interface StoreState {
  /** Where an order can go right now. Empty = view only. */
  choices: StoreChoice[];
  /** Plain reasons, for staff: why each lane is or is not open. */
  reasons: string[];
}

/**
 * Which order types the storefront offers right now.
 * - A preorder lane is open while its batch is open and today is within its dates.
 * - Mail order needs the staff switch on, and pauses while any preorder is open or an event is running.
 * - "Open mail order anyway" shows mail order regardless, until the end of the day it was set.
 */
export function storeState(catalog: StoreCatalog | null, status: StoreStatus | null, docs: Record<string, PublicForm | null | undefined>, now = Date.now()): StoreState {
  const reasons: string[] = [];
  if (!catalog) return { choices: [], reasons: ['The storefront has not been published yet.'] };
  const preorders: StoreChoice[] = [];
  for (const lane of catalog.lanes.filter((l) => l.kind === 'preorder')) {
    const doc = docs[lane.id];
    if (!doc || !doc.enabled) { reasons.push(`${lane.eventCode} preorder: batch not open.`); continue; }
    const w = windowState(doc, now);
    if (w === 'before') { reasons.push(`${lane.eventCode} preorder opens ${new Date(doc.acceptFrom!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`); continue; }
    if (w === 'after') { reasons.push(`${lane.eventCode} preorder closed on its end date.`); continue; }
    preorders.push({ lane, doc, label: `Preorder for ${lane.eventName}`, detail: preorderDetail(lane) });
    reasons.push(`${lane.eventCode} preorder is open.`);
  }
  const mailLane = catalog.lanes.find((l) => l.kind === 'mail_order');
  const mailDoc = mailLane ? docs[mailLane.id] : undefined;
  const running = catalog.eventDays.find((e) => now >= e.from && now <= e.until);
  const override = overrideActive(status, now);
  let mail: StoreChoice | null = null;
  if (mailLane && mailDoc && mailDoc.enabled) {
    const choice = { lane: mailLane, doc: mailDoc, label: 'Mail order', detail: 'Shipped to you. Ships after current events end.' };
    if (override) { mail = choice; reasons.push('Mail order is open by staff override until the end of today.'); }
    else if (!status?.mailOrderOpen) reasons.push('Mail order is switched off.');
    else if (preorders.length > 0) reasons.push('Mail order is paused while a preorder is open.');
    else if (running) reasons.push(`Mail order is paused during ${running.name}.`);
    else { mail = choice; reasons.push('Mail order is open.'); }
  } else {
    reasons.push(status?.mailOrderOpen || override ? 'Mail order is switched on but the storefront needs publishing.' : 'Mail order is switched off.');
  }
  const choices = mail ? [...preorders, mail] : preorders;
  if (choices.length === 0) reasons.push('Nothing is open, so the storefront is view only.');
  return { choices, reasons };
}

function preorderDetail(lane: StoreLaneInfo): string {
  const fmt = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const dates = lane.startDate ? (lane.endDate && lane.endDate !== lane.startDate ? `${fmt(lane.startDate)}–${fmt(lane.endDate)}` : fmt(lane.startDate)) : '';
  const until = lane.closesAt ? `Open until ${fmt(lane.closesAt)}` : '';
  return [until, dates && `pick up ${dates} at the booth, or ship after the event`, 'preorder price'].filter(Boolean).join(' · ');
}

export interface StorePrice extends Quote {
  /** Present when the key comes from the live price list. */
  entryId?: string;
}

/** Price of one key for an order type, live when possible, else the catalogue's fallback. */
export function storePrice(key: string, fallback: StoreCatalog['products'][number]['variants'][number]['fallback'], orderType: OrderType, live: PublicPrices | null, override?: number, basisFallback?: Record<OrderType, 'po' | 'ots'>): StorePrice {
  const lp = live?.items?.[key];
  const basis = live?.basis ?? basisFallback ?? storefrontOf({}).priceBasis;
  return { ...quote(lp ?? fallback, orderType, basis, override), entryId: lp?.entryId };
}
