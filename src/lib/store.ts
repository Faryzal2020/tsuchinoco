// Storefront logic with no Firestore access, so the staff app, the customer page and the
// localhost sandbox all share it. Writes live in storeActions.ts.
//
// The storefront is one catalogue (publicStore/catalog) plus one "lane" per place an order can go.
// Each lane is a publicForms document, so the existing submission rules validate storefront orders
// exactly like Forms orders: `store_<batchId>` for an open preorder batch, `store_mail` for mail order.
import type {
  Batch, Event, FormDoc, Item, Media, OrderType, PublicForm, PublicPrices, Settings, StoreCatalog, StoreLaneInfo, StoreProduct, StoreStatus,
} from '@/types';
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

/** Every active item, with its active variants, as the storefront lists it. */
export function buildProducts(items: Item[], media: Map<string, Media>): StoreProduct[] {
  return items
    .filter((i) => i.active)
    .map((i) => ({
      itemId: i.id, name: i.name, kind: i.kind, type: i.kind === 'bundle' ? 'bundle' : i.type,
      category: i.category || undefined, artist: i.artist || undefined, thumb: mediaSrc(media, i.thumbnailId),
      variants: (i.kind === 'bundle' ? [{ id: '', name: '' }] : variantsOf(i).filter((v) => v.active)).map((v) => {
        const key = i.kind === 'bundle' ? i.id : variantKey(i.id, v.id);
        const p = catalogPrice(i, key);
        return { key, name: v.name, thumb: mediaSrc(media, i.kind === 'bundle' ? undefined : variantOf(i, v.id)?.thumbnailId), fallback: { po: p.po, ots: p.ots, ...(p.discountPercent ? { discountPercent: p.discountPercent } : {}) } };
      }),
    }))
    .filter((p) => p.variants.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const mediaIdsForProducts = (items: Item[]): string[] => {
  const ids = new Set<string>();
  for (const i of items) {
    if (!i.active) continue;
    if (i.thumbnailId) ids.add(i.thumbnailId);
    for (const v of i.variants ?? []) if (v.thumbnailId) ids.add(v.thumbnailId);
  }
  return [...ids];
};

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
}): StoreBuild {
  const { items, events, batches, formsById, media, settings, storeEvent, status } = input;
  const sf = storefrontOf(settings);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const products = buildProducts(items, media);
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

  const catalog: StoreBuild['catalog'] = {
    title: sf.shopTitle ?? '', intro: sf.shopIntro ?? '', currency: settings.currency,
    products, lanes: laneInfo, eventDays, sections: [], highlights: [],
    paymentText: sf.paymentText ?? '', paymentChoices: sf.paymentChoices ?? [],
    requirePhone: true, requireEmail: true, publishedHash: '',
  };
  return { catalog, lanes };
}

/**
 * Hash of what a publish would write, independent of where images are stored: thumbnails count by
 * media id. Publish stores it; the Storefront page compares it to show "changed since publish".
 */
export function storeHashFor(input: Omit<Parameters<typeof buildStorefront>[0], 'media'>): string {
  const stub = new Map(mediaIdsForProducts(input.items).map((id) => [id, { url: id } as Media]));
  const b = buildStorefront({ ...input, media: stub });
  return storeHash(b.catalog, b.lanes);
}

/** Stable hash of what a publish would write, for "changed since publish". Prices are live and left out. */
export function storeHash(catalog: StoreBuild['catalog'], lanes: StoreBuild['lanes']): string {
  const products = catalog.products.map((p) => [p.itemId, p.name, p.type, p.category, p.artist, p.thumb ?? '', p.variants.map((v) => [v.key, v.name, v.thumb ?? ''])]);
  const ls = lanes.map((l) => [l.id, l.doc.batchId, Object.keys(l.doc.items).sort(), l.doc.acceptFrom, l.doc.acceptUntil, l.doc.overrides, l.doc.settings.pickupDays]);
  const s = JSON.stringify([catalog.title, catalog.intro, catalog.paymentText, catalog.paymentChoices, products, ls, catalog.eventDays]);
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
