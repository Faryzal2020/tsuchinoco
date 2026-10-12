import type { Batch, Event, Item, Order, OrderLine, StockMovement, Wrapup } from '@/types';
import { OPEN_ORDER_STATUSES } from '@/types';
import { splitKey, variantKey, variantsOf, variantOtsPrice } from './keys';

export type QtyByKey = Map<string, number>;

const add = (m: QtyByKey, key: string, qty: number) => m.set(key, (m.get(key) ?? 0) + qty);

// ---------- 4.1 Stock ----------

export function onHandByKey(movements: StockMovement[]): QtyByKey {
  const m: QtyByKey = new Map();
  for (const mv of movements) add(m, variantKey(mv.itemId, mv.variantId), mv.qty);
  return m;
}

/** Units promised to orders not yet collected, shipped, or cancelled. Across all events. */
export function committedByKey(openOrders: Order[]): QtyByKey {
  const m: QtyByKey = new Map();
  for (const o of openOrders) {
    if (!OPEN_ORDER_STATUSES.includes(o.status)) continue;
    for (const l of o.lines) add(m, variantKey(l.itemId, l.variantId), l.qty);
  }
  return m;
}

export interface StockRow {
  key: string;
  itemId: string;
  variantId: string;
  onHand: number;
  committed: number;
  available: number;
}

export function stockRows(items: Item[], movements: StockMovement[], openOrders: Order[]): StockRow[] {
  const onHand = onHandByKey(movements);
  const committed = committedByKey(openOrders);
  const rows: StockRow[] = [];
  for (const item of items) {
    if (item.kind !== 'product') continue;
    for (const v of variantsOf(item)) {
      const key = variantKey(item.id, v.id);
      const oh = onHand.get(key) ?? 0;
      const cm = committed.get(key) ?? 0;
      rows.push({ key, itemId: item.id, variantId: v.id, onHand: oh, committed: cm, available: oh - cm });
    }
  }
  // Keys that exist in the ledger or orders but whose item/variant is gone still count.
  const known = new Set(rows.map((r) => r.key));
  for (const key of new Set([...onHand.keys(), ...committed.keys()])) {
    if (known.has(key)) continue;
    const { itemId, variantId } = splitKey(key);
    const oh = onHand.get(key) ?? 0;
    const cm = committed.get(key) ?? 0;
    rows.push({ key, itemId, variantId, onHand: oh, committed: cm, available: oh - cm });
  }
  return rows;
}

// ---------- 4.2 Planning ----------

export interface PlanningRow {
  key: string;
  itemId: string;
  variantId: string;
  preorderPickup: number;
  preorderMail: number;
  onsiteExtra: number;
  onHand: number;
  committed: number;
  available: number;
  incoming: number;
  netToOrder: number;
  ordered: number;
  received: number;
}

/** Variant keys covered by a batch's offering, bundles expanded to their components. */
export function offeringKeys(batch: Batch, itemsById: Map<string, Item>): string[] {
  const keys = new Set<string>();
  for (const e of batch.offering) {
    const item = itemsById.get(e.itemId);
    if (!item) continue;
    if (item.kind === 'bundle') {
      for (const c of item.components) keys.add(variantKey(c.itemId, c.variantId));
    } else if (e.variantId) {
      keys.add(variantKey(e.itemId, e.variantId));
    } else {
      for (const v of variantsOf(item)) keys.add(variantKey(item.id, v.id));
    }
  }
  return [...keys];
}

export function planningRows(
  batch: Batch,
  eventBatches: Batch[],
  batchOrders: Order[],
  items: Item[],
  movements: StockMovement[],
  openOrders: Order[],
): PlanningRow[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const stock = new Map(stockRows(items, movements, openOrders).map((r) => [r.key, r]));
  const pickup: QtyByKey = new Map();
  const mail: QtyByKey = new Map();
  for (const o of batchOrders) {
    if (o.status === 'cancelled') continue;
    const target = o.fulfilment === 'pickup' ? pickup : mail;
    for (const l of o.lines) add(target, variantKey(l.itemId, l.variantId), l.qty);
  }
  const incoming: QtyByKey = new Map();
  for (const b of eventBatches) {
    if (b.id === batch.id) continue;
    for (const [key, p] of Object.entries(b.planning ?? {})) add(incoming, key, Math.max(0, (p.ordered ?? 0) - (p.received ?? 0)));
  }

  const keys = new Set<string>(offeringKeys(batch, itemsById));
  for (const k of pickup.keys()) keys.add(k);
  for (const k of mail.keys()) keys.add(k);

  const rows: PlanningRow[] = [];
  for (const key of keys) {
    const { itemId, variantId } = splitKey(key);
    const s = stock.get(key);
    const p = batch.planning?.[key] ?? { onsiteExtra: 0, ordered: 0, received: 0 };
    const pp = pickup.get(key) ?? 0;
    const pm = mail.get(key) ?? 0;
    const available = s?.available ?? 0;
    const inc = incoming.get(key) ?? 0;
    rows.push({
      key,
      itemId,
      variantId,
      preorderPickup: pp,
      preorderMail: pm,
      onsiteExtra: p.onsiteExtra ?? 0,
      onHand: s?.onHand ?? 0,
      committed: s?.committed ?? 0,
      available,
      incoming: inc,
      netToOrder: Math.max(0, pp + pm + (p.onsiteExtra ?? 0) - available - inc),
      ordered: p.ordered ?? 0,
      received: p.received ?? 0,
    });
  }
  return rows;
}

// ---------- 4.3 / 4.5 Wrap-up ----------

export interface WrapupComputedRow {
  key: string;
  itemId: string;
  variantId: string;
  brought: number | null;
  pickupsCollected: number;
  leftover: number | null;
  walkinSold: number | null;
  bundleUnits: number;
  looseUnits: number | null;
  onHand: number;
}

export function pickupsCollectedByKey(eventOrders: Order[]): QtyByKey {
  const m: QtyByKey = new Map();
  for (const o of eventOrders) {
    if (o.status !== 'collected') continue;
    for (const l of o.lines) add(m, variantKey(l.itemId, l.variantId), l.qty);
  }
  return m;
}

export function bundleUnitsByKey(bundlesSold: Record<string, number>, itemsById: Map<string, Item>): QtyByKey {
  const m: QtyByKey = new Map();
  for (const [bundleId, count] of Object.entries(bundlesSold)) {
    const b = itemsById.get(bundleId);
    if (!b || !count) continue;
    for (const c of b.components) add(m, variantKey(c.itemId, c.variantId), c.qty * count);
  }
  return m;
}

export function wrapupRows(
  wrapup: Wrapup | undefined,
  eventOrders: Order[],
  items: Item[],
  movements: StockMovement[],
  openOrders: Order[],
): WrapupComputedRow[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const stock = new Map(stockRows(items, movements, openOrders).map((r) => [r.key, r]));
  const pickups = pickupsCollectedByKey(eventOrders);
  const bundleUnits = bundleUnitsByKey(wrapup?.bundlesSold ?? {}, itemsById);

  // Rows: every variant that has stock on hand, any order line in this event, or a saved row.
  const keys = new Set<string>();
  for (const [k, r] of stock) if (r.onHand !== 0 || r.committed !== 0) keys.add(k);
  for (const o of eventOrders) for (const l of o.lines) keys.add(variantKey(l.itemId, l.variantId));
  for (const k of Object.keys(wrapup?.rows ?? {})) keys.add(k);

  const rows: WrapupComputedRow[] = [];
  for (const key of keys) {
    const { itemId, variantId } = splitKey(key);
    const saved = wrapup?.rows?.[key];
    const onHand = stock.get(key)?.onHand ?? 0;
    const brought = saved?.brought ?? null;
    const leftover = saved?.leftover ?? null;
    const pc = pickups.get(key) ?? 0;
    const walkin = brought !== null && leftover !== null ? brought - leftover - pc : null;
    const bu = bundleUnits.get(key) ?? 0;
    rows.push({
      key,
      itemId,
      variantId,
      brought,
      pickupsCollected: pc,
      leftover,
      walkinSold: walkin,
      bundleUnits: bu,
      looseUnits: walkin === null ? null : walkin - bu,
      onHand,
    });
  }
  return rows;
}

export function walkinRevenue(rows: WrapupComputedRow[], bundlesSold: Record<string, number>, itemsById: Map<string, Item>): number {
  let total = 0;
  for (const [bundleId, count] of Object.entries(bundlesSold)) {
    const b = itemsById.get(bundleId);
    if (b && count) {
      const price = b.otsPrice ?? b.price;
      total += count * price;
    }
  }
  for (const r of rows) {
    if (r.looseUnits === null || r.looseUnits <= 0) continue;
    const item = itemsById.get(r.itemId);
    const price = variantOtsPrice(item, r.variantId);
    total += r.looseUnits * price;
  }
  return total;
}

// ---------- Order helpers ----------

export function linesByKey(lines: OrderLine[]): QtyByKey {
  const m: QtyByKey = new Map();
  for (const l of lines) add(m, variantKey(l.itemId, l.variantId), l.qty);
  return m;
}

export function orderItemCount(o: Order): number {
  return o.rawLines.reduce((s, l) => s + l.qty, 0);
}

// ---------- 4.7 Report ----------

export interface ReportRow {
  key: string;
  itemId: string;
  variantId: string;
  produced: number;
  soldPickup: number;
  soldWalkin: number;
  soldMail: number;
  leftover: number | null;
  leftoverValue: number;
  revenue: number;
  margin: number | null;
}

export interface Report {
  preorderPickup: number;
  preorderMail: number;
  postMail: number;
  walkin: number;
  total: number;
  rows: ReportRow[];
}

export function eventReport(
  event: Event,
  batches: Batch[],
  eventOrders: Order[],
  wrapup: Wrapup | undefined,
  items: Item[],
  movements: StockMovement[],
  openOrders: Order[],
): Report {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const rows = wrapupRows(wrapup, eventOrders, items, movements, openOrders);
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  let preorderPickup = 0, preorderMail = 0, postMail = 0;
  const soldMail: QtyByKey = new Map();
  const revenueByKey: QtyByKey = new Map();
  for (const o of eventOrders) {
    if (o.status === 'cancelled') continue;
    const b = batchById.get(o.batchId);
    if (o.fulfilment === 'pickup') preorderPickup += o.total;
    else if (b?.mode === 'post') postMail += o.total;
    else preorderMail += o.total;
    for (const l of o.lines) {
      const key = variantKey(l.itemId, l.variantId);
      if (o.status === 'shipped') add(soldMail, key, l.qty);
      if (o.status === 'collected' || o.status === 'shipped') add(revenueByKey, key, l.qty * l.unitPrice);
    }
  }

  const produced: QtyByKey = new Map();
  for (const b of batches) for (const [k, p] of Object.entries(b.planning ?? {})) add(produced, k, p.received ?? 0);

  const walkin = walkinRevenue(rows, wrapup?.bundlesSold ?? {}, itemsById);
  // Walk-in revenue per variant: loose units at list price + allocated bundle share.
  const bundleUnits = bundleUnitsByKey(wrapup?.bundlesSold ?? {}, itemsById);
  for (const [bundleId, count] of Object.entries(wrapup?.bundlesSold ?? {})) {
    const b = itemsById.get(bundleId);
    if (!b || !count) continue;
    const alloc = allocateForReport(b, itemsById);
    for (const c of b.components) add(revenueByKey, variantKey(c.itemId, c.variantId), (alloc.get(variantKey(c.itemId, c.variantId)) ?? 0) * c.qty * count);
  }
  for (const r of rows) {
    if (r.looseUnits && r.looseUnits > 0) add(revenueByKey, r.key, r.looseUnits * (itemsById.get(r.itemId)?.price ?? 0));
  }

  const keys = new Set<string>([...rowByKey.keys(), ...produced.keys(), ...soldMail.keys()]);
  const reportRows: ReportRow[] = [];
  for (const key of keys) {
    const { itemId, variantId } = splitKey(key);
    const item = itemsById.get(itemId);
    const r = rowByKey.get(key);
    const sp = r?.pickupsCollected ?? 0;
    const sw = r?.walkinSold ?? 0;
    const sm = soldMail.get(key) ?? 0;
    const sold = sp + sw + sm;
    const price = item?.price ?? 0;
    const revenue = revenueByKey.get(key) ?? 0;
    reportRows.push({
      key,
      itemId,
      variantId,
      produced: produced.get(key) ?? 0,
      soldPickup: sp,
      soldWalkin: sw,
      soldMail: sm,
      leftover: r?.leftover ?? null,
      leftoverValue: (r?.leftover ?? 0) * price,
      revenue,
      margin: typeof item?.cost === 'number' ? revenue - sold * item.cost : null,
    });
    void bundleUnits;
  }
  const total = preorderPickup + preorderMail + postMail + walkin;
  return { preorderPickup, preorderMail, postMail, walkin, total, rows: reportRows };
}

import { allocateBundlePrice } from './bundle';
function allocateForReport(b: Item, itemsById: Map<string, Item>) {
  return allocateBundlePrice(b, itemsById);
}
