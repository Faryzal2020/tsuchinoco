// Sample data for the localhost sandbox. Dates are relative to today so the storefront is always
// in an interesting state: a preorder open for an event three weeks out, mail order switched on
// (and therefore paused), a wrapped event with post-event mail orders on hold.
import type { Batch, Event, Item, LivePrice, Order, PublicPrices, Settings, Staff, StoreStatus } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { catalogPrice, keysOf, storefrontOf } from '@/lib/pricing';
import { monthBatchFor } from '@/lib/store';

export const SANDBOX_ME = 'sandbox@localhost';
const DAY = 86_400_000;
const iso = (offsetDays: number) => { const d = new Date(Date.now() + offsetDays * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const meta = { createdAt: Date.now() - 30 * DAY, updatedAt: Date.now() - DAY, updatedBy: SANDBOX_ME };

export interface SandboxState {
  staff: Staff[];
  items: Item[];
  events: Event[];
  batches: Batch[];
  orders: Order[];
  settings: Settings;
  publicPrices: PublicPrices;
  storeStatus: StoreStatus;
  counters: Record<string, number>;
}

const product = (id: string, name: string, type: string, price: number, ots: number, opts: Partial<Item> = {}): Item => ({
  id, name, kind: 'product', type, managerId: SANDBOX_ME, price, otsPrice: ots, producedAt: '', active: true, variants: [], components: [], notes: '', ...meta, ...opts,
});
const v = (id: string, name: string, extra = {}) => ({ id, name, active: true, ...extra });

export function makeSandbox(): SandboxState {
  const items: Item[] = [
    product('standee', 'Kitsune Shrine Acrylic Standee', 'acrylic standee', 70000, 85000, { category: 'Kitsune Shrine', artist: 'Rina', variants: [v('15', '15 cm'), v('20', '20 cm', { price: 90000, otsPrice: 110000 })] }),
    product('sticker', 'Night Market Sticker Sheet', 'sticker', 30000, 35000, { category: 'Night Market', artist: 'Tomo', discountPercent: 20, variants: [v('gloss', 'Glossy'), v('holo', 'Holo', { price: 35000, otsPrice: 40000 })] }),
    product('keychain', 'Lantern Keychain', 'acrylic keychain', 35000, 40000, { category: 'Night Market', artist: 'Tomo', variants: [v('red', 'Red'), v('blue', 'Blue'), v('gold', 'Gold')] }),
    product('guide', 'Tsuchinoco Field Guide Vol. 2', 'book comic', 120000, 120000, { artist: 'Rina', variants: [v('id', 'Bahasa Indonesia'), v('en', 'English')] }),
    product('poster', 'Shrine at Dusk Poster', 'poster a3', 45000, 50000, { category: 'Kitsune Shrine', artist: 'Rina' }),
    product('tee', 'Circle Logo T-Shirt', 't-shirt', 150000, 165000, { variants: [v('s', 'S'), v('m', 'M'), v('l', 'L'), v('xl', 'XL')] }),
    product('mug', 'Enamel Mug', 'other', 95000, 95000, { mailOrder: false }),
    { id: 'starter', name: 'Starter Bundle', kind: 'bundle', type: 'bundle', managerId: SANDBOX_ME, price: 90000, otsPrice: 105000, producedAt: '', active: true, variants: [],
      components: [{ itemId: 'sticker', variantId: 'gloss', qty: 1 }, { itemId: 'keychain', variantId: 'red', qty: 1 }, { itemId: 'poster', variantId: 'default', qty: 1 }], notes: '', ...meta },
  ];

  const events: Event[] = [
    { id: 'cf24', name: 'Comic Frontier 24', code: 'CF24', startDate: iso(20), endDate: iso(21), venue: 'ICE BSD', status: 'upcoming', pickupDeadlineDays: 30, notes: '', ...meta },
    { id: 'cf23', name: 'Comic Frontier 23', code: 'CF23', startDate: iso(-40), endDate: iso(-39), venue: 'ICE BSD', status: 'wrapped', pickupDeadlineDays: 30, notes: '', ...meta },
    { id: 'store', name: 'Mail order', code: 'MO', kind: 'store', startDate: '', endDate: '', venue: '', status: 'upcoming', pickupDeadlineDays: 30, notes: '', ...meta },
  ];
  const offering = [
    ...['standee:15', 'standee:20', 'sticker:gloss', 'sticker:holo', 'keychain:red', 'keychain:blue', 'keychain:gold', 'guide:id', 'tee:s', 'tee:m', 'tee:l', 'tee:xl'].map((k) => ({ itemId: k.split(':')[0], variantId: k.split(':')[1] })),
    { itemId: 'starter' },
  ];
  const month = monthBatchFor(Date.now());
  const batches: Batch[] = [
    { id: 'cf24b1', eventId: 'cf24', number: 1, mode: 'preorder', status: 'open', opensAt: iso(-5), closesAt: iso(10), offering, planning: {}, ...meta },
    { id: 'cf23b3', eventId: 'cf23', number: 3, mode: 'post', status: 'open', opensAt: iso(-38), closesAt: iso(-10), offering: [], planning: {}, ...meta },
    { id: month.id, eventId: 'store', number: month.number, mode: 'post', status: 'open', opensAt: '', closesAt: '', offering: [], planning: {}, storefront: false, ...meta },
  ];

  const line = (itemId: string, variantId: string | undefined, qty: number, unitPrice: number) => ({ itemId, variantId, qty, unitPrice, lineTotal: qty * unitPrice });
  const order = (o: Partial<Order> & Pick<Order, 'id' | 'eventId' | 'batchId' | 'transactionId' | 'customer' | 'fulfilment' | 'status' | 'rawLines'>): Order => ({
    source: 'web', externalId: '', submittedAt: Date.now() - 3 * DAY, notes: '', total: o.rawLines.reduce((s, l) => s + l.lineTotal, 0),
    lines: o.rawLines.map((l) => ({ itemId: l.itemId, variantId: l.variantId ?? 'default', qty: l.qty, unitPrice: l.unitPrice })), ...meta, ...o,
  });
  const c = (name: string, address?: string) => ({ name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, phone: '0812 0000 0000', ...(address ? { address } : {}) });
  const orders: Order[] = [
    order({ id: 'o1', eventId: 'cf24', batchId: 'cf24b1', transactionId: 'CF24_1_0001', customer: c('Dimas Ardi'), fulfilment: 'pickup', pickupDay: 'Day 2', status: 'awaiting_pickup', orderType: 'preorder', payment: 'paid', paidAt: Date.now() - DAY, paidBy: SANDBOX_ME, source: 'store', rawLines: [line('standee', '15', 2, 70000), line('sticker', 'gloss', 1, 24000)], submittedAt: Date.now() - 4 * DAY }),
    order({ id: 'o2', eventId: 'cf24', batchId: 'cf24b1', transactionId: 'CF24_1_0002', customer: c('Nadia Putri', 'Jl. Melati 12, Bandung 40115'), fulfilment: 'mail', status: 'awaiting_shipment', orderType: 'preorder', payment: 'unpaid', paymentProofUrl: 'https://example.com/receipt.jpg', paymentMethod: 'Bank transfer', rawLines: [line('keychain', 'blue', 1, 35000), line('tee', 'm', 1, 150000)], submittedAt: Date.now() - 2 * DAY }),
    order({ id: 'o3', eventId: 'cf24', batchId: 'cf24b1', transactionId: 'CF24_1_0003', customer: c('Bayu Santoso'), fulfilment: 'pickup', pickupDay: 'Day 1', status: 'awaiting_pickup', orderType: 'preorder', payment: 'unpaid', source: 'manual', rawLines: [line('starter', undefined, 1, 90000)], submittedAt: Date.now() - DAY }),
    order({ id: 'o4', eventId: 'cf24', batchId: 'cf24b1', transactionId: 'CF24_1_0004', customer: c('Laras Wening'), fulfilment: 'pickup', pickupDay: 'Day 1', status: 'awaiting_pickup', orderType: 'preorder', payment: 'unpaid', source: 'store', priceFlag: 'Price changed during checkout: Kitsune Shrine Acrylic Standee · 20 cm. Confirm the total with the customer.', rawLines: [line('standee', '20', 1, 90000)], submittedAt: Date.now() - 6 * 3_600_000 }),
    order({ id: 'o5', eventId: 'cf23', batchId: 'cf23b3', transactionId: 'CF23_3_0012', customer: c('Sari Wulandari', 'Jl. Kenanga 4, Yogyakarta 55281'), fulfilment: 'mail', status: 'awaiting_shipment', orderType: 'mail_order', payment: 'paid', paidAt: Date.now() - 9 * DAY, paidBy: SANDBOX_ME, rawLines: [line('poster', 'default', 2, 50000)], submittedAt: Date.now() - 12 * DAY }),
    order({ id: 'o6', eventId: 'store', batchId: month.id, transactionId: `MO_${month.number}_0001`, customer: c('Kevin Susanto', 'Jl. Anggrek 9, Surabaya 60111'), fulfilment: 'mail', status: 'awaiting_shipment', orderType: 'mail_order', payment: 'paid', paidAt: Date.now() - 2 * DAY, paidBy: SANDBOX_ME, source: 'store', paymentMethod: 'QRIS', rawLines: [line('guide', 'en', 1, 120000)], submittedAt: Date.now() - 3 * DAY }),
    order({ id: 'o7', eventId: 'cf23', batchId: 'cf23b3', transactionId: 'CF23_3_0009', customer: c('Rani Kusuma', 'Jl. Dahlia 1, Jakarta 12110'), fulfilment: 'mail', status: 'shipped', shippedAt: Date.now() - 20 * DAY, orderType: 'mail_order', payment: 'paid', tracking: { courier: 'JNE', number: 'CGK0001122334' }, rawLines: [line('sticker', 'holo', 2, 40000)], submittedAt: Date.now() - 30 * DAY }),
    order({ id: 'o8', eventId: 'cf23', batchId: 'cf23b3', transactionId: 'CF23_3_0010', customer: c('Agus Hartono'), fulfilment: 'mail', status: 'cancelled', cancelledAt: Date.now() - 15 * DAY, orderType: 'mail_order', payment: 'unpaid', rawLines: [line('keychain', 'gold', 1, 40000)], submittedAt: Date.now() - 28 * DAY }),
  ];

  // Live price list straight from the catalogue; the 20 cm standee changed an hour ago.
  const settings: Settings = { ...DEFAULT_SETTINGS, storefront: storefrontOf({}) };
  const now = Date.now();
  const list: Record<string, LivePrice> = {};
  for (const it of items) for (const key of keysOf(it)) {
    const p = catalogPrice(it, key);
    list[key] = { entryId: `e-${key}`, po: p.po, ots: p.ots, discountPercent: p.discountPercent, since: now - 10 * DAY };
  }
  list['standee:20'] = { ...list['standee:20'], entryId: 'e-standee:20-new', since: now - 3_600_000, prev: { entryId: 'e-standee:20', po: 80000, ots: 100000 } };
  const publicPrices: PublicPrices = { basis: storefrontOf(settings).priceBasis, graceMinutes: 60, items: list, updatedAt: now };

  return {
    staff: [{ id: SANDBOX_ME, email: SANDBOX_ME, displayName: 'Sandbox staff', active: true, ...meta }],
    items, events, batches, orders, settings, publicPrices,
    storeStatus: { mailOrderOpen: true, updatedAt: now },
    counters: { cf24b1: 5, cf23b3: 13, [month.id]: 2 },
  };
}
