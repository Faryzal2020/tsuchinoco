// Price history and the live public price list.
// Every catalogue write calls syncPriceList afterwards. It compares each key's catalogue price with
// publicPrices/current and, for every key that changed, appends a priceHistory entry and updates the
// list. Customer pages read the list live, so a price change shows within seconds without a republish.
// Orders keep the price entry and unit price they were made with, so they never change afterwards.
import { collection, deleteField, doc, FieldPath, getDoc, getDocs, query, setDoc, where, writeBatch, type WriteBatch } from 'firebase/firestore';
import { meterRead } from './readMeter';
import { db } from './firebase';
import { COL, clean, logActivity } from './repo';
import { newId } from './keys';
import { catalogPrice, keysOf, samePrice, storefrontOf, validDiscount } from './pricing';
import type { Item, LivePrice, PriceEntry, PublicPrices, Settings } from '@/types';

export const PUBLIC_PRICES_ID = 'current';
const listRef = () => doc(db, COL.publicPrices, PUBLIC_PRICES_ID);

async function commitChunked(ops: ((b: WriteBatch) => void)[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) op(b);
    await b.commit();
  }
}

/**
 * Bring the live price list in line with the catalogue for the given items (all items when omitted).
 * Items that no longer exist lose their keys. Returns the number of keys whose price changed.
 */
export async function syncPriceList(by: string, itemIds?: string[], note?: string): Promise<number> {
  const listSnap = await getDoc(listRef());
  if (!listSnap.exists()) {
    const sf = storefrontOf({});
    await setDoc(listRef(), { basis: sf.priceBasis, graceMinutes: sf.graceMinutes, items: {}, updatedAt: Date.now() });
  }
  const current = (listSnap.exists() ? (listSnap.data() as PublicPrices).items : undefined) ?? {};

  let items: Item[];
  let goneIds: string[] = [];
  if (itemIds) {
    const snaps = await Promise.all([...new Set(itemIds)].map((id) => getDoc(doc(db, COL.items, id))));
    items = snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }) as Item);
    goneIds = snaps.filter((s) => !s.exists()).map((s) => s.id);
  } else {
    const all = await getDocs(collection(db, COL.items));
    meterRead('priceSync:items', all.size);
    items = all.docs.map((d) => ({ id: d.id, ...d.data() }) as Item);
  }

  const now = Date.now();
  const updates: Record<string, LivePrice | ReturnType<typeof deleteField>> = {};
  const entries: PriceEntry[] = [];
  const liveKeys = new Set<string>();

  for (const item of items) {
    for (const key of keysOf(item)) {
      liveKeys.add(key);
      const p = catalogPrice(item, key);
      const was = current[key];
      if (was && samePrice(was, p)) continue;
      const entry: PriceEntry = { id: newId(), itemId: item.id, key, po: p.po, ots: p.ots, discountPercent: p.discountPercent, effectiveFrom: now, by, note: note || undefined };
      entries.push(entry);
      updates[key] = clean({
        entryId: entry.id, po: p.po, ots: p.ots, discountPercent: p.discountPercent, since: now,
        prev: was ? { entryId: was.entryId, po: was.po, ots: was.ots, discountPercent: validDiscount(was.discountPercent) } : undefined,
      });
    }
  }
  // Keys that belong to deleted items or removed variants.
  const touched = new Set([...items.map((i) => i.id), ...goneIds]);
  for (const key of Object.keys(current)) {
    const owner = key.includes(':') ? key.slice(0, key.indexOf(':')) : key;
    if ((!itemIds || touched.has(owner)) && !liveKeys.has(key)) updates[key] = deleteField();
  }
  if (Object.keys(updates).length === 0) return 0;

  const ops: ((b: WriteBatch) => void)[] = entries.map((e) => (b) => {
    const { id, ...rest } = e;
    b.set(doc(db, COL.priceHistory, id), clean(rest));
  });
  // The list goes last so a failed history write never leaves a price without its entry.
  // Field paths replace each key whole (a merge would keep a removed discount).
  const pairs = Object.entries(updates);
  for (let i = 0; i < pairs.length; i += 300) {
    const args: unknown[] = [];
    for (const [k, v] of pairs.slice(i, i + 300)) args.push(new FieldPath('items', k), v);
    ops.push((b) => b.update(listRef(), 'updatedAt', now, ...args));
  }
  await commitChunked(ops);

  if (entries.length > 0) {
    await logActivity('update', 'price', `Price change recorded for ${entries.length} ${entries.length === 1 ? 'variant' : 'variants'}`, by, {
      entityId: entries.length === 1 ? entries[0].itemId : undefined,
    });
  }
  return entries.length;
}

/** Copy the price basis and grace period from settings onto the public list. */
export async function syncPriceBasis(settings: Pick<Settings, 'storefront'>): Promise<void> {
  const sf = storefrontOf(settings);
  await writeBatch(db).set(listRef(), { basis: sf.priceBasis, graceMinutes: sf.graceMinutes, updatedAt: Date.now() }, { merge: true }).commit();
}

/** Price history of one item, newest first. */
export async function priceHistoryOf(itemId: string): Promise<PriceEntry[]> {
  const snap = await getDocs(query(collection(db, COL.priceHistory), where('itemId', '==', itemId)));
  meterRead('priceHistory', snap.size);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PriceEntry).sort((a, b) => b.effectiveFrom - a.effectiveFrom);
}
