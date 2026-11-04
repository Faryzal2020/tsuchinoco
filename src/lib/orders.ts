// How an order reads to staff: its type, payment, combined stage, and the mail-order hold.
// Older orders have no orderType or payment field; the fallbacks below derive them so every
// screen works before and after the one-off migration in Settings.
import type { Batch, Courier, Event, Order, OrderStatus, OrderType, PaymentStatus } from '@/types';
import { OPEN_ORDER_STATUSES } from '@/types';
import { eventCode } from './forms';
import { formatDate, todayIso } from './format';

export const isStoreEvent = (e: Pick<Event, 'kind'> | undefined): boolean => e?.kind === 'store';

export function orderTypeOf(o: Pick<Order, 'orderType'>, batch?: Pick<Batch, 'mode'>, event?: Pick<Event, 'kind'>): OrderType {
  if (o.orderType) return o.orderType;
  if (isStoreEvent(event) || batch?.mode === 'post') return 'mail_order';
  return 'preorder';
}

/** Collected and delivered orders were paid; everything else counts as unpaid until marked. */
export const paymentOf = (o: Pick<Order, 'payment' | 'status'>): PaymentStatus =>
  o.payment ?? (o.status === 'collected' || o.status === 'shipped' ? 'paid' : 'unpaid');

export const isUnfulfilled = (o: Pick<Order, 'status'>): boolean => OPEN_ORDER_STATUSES.includes(o.status);

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_pickup: 'Awaiting pickup',
  collected: 'Picked up',
  not_collected: 'Not collected',
  awaiting_shipment: 'Awaiting shipment',
  shipped: 'Delivered',
  cancelled: 'Cancelled',
};

/** The one stage staff see: Unpaid → Paid → Picked up / Delivered, with Not collected and Cancelled as side exits. */
export function stageOf(o: Pick<Order, 'payment' | 'status'>): { label: string; tone: 'yellow' | 'blue' | 'green' | 'red' | 'neutral' } {
  switch (o.status) {
    case 'cancelled': return { label: 'Cancelled', tone: 'neutral' };
    case 'collected': return { label: 'Picked up', tone: 'green' };
    case 'shipped': return { label: 'Delivered', tone: 'green' };
    case 'not_collected': return { label: paymentOf(o) === 'paid' ? 'Not collected' : 'Not collected, unpaid', tone: 'red' };
    default: return paymentOf(o) === 'paid' ? { label: 'Paid', tone: 'blue' } : { label: 'Unpaid', tone: 'yellow' };
  }
}

/** The event an open mail order waits for: the next event that has not ended. Null when it can ship now. */
export function holdOf(o: Order, type: OrderType, events: Event[], today = todayIso()): Event | null {
  if (type !== 'mail_order' || o.holdReleased || !isUnfulfilled(o)) return null;
  const waiting = events
    .filter((e) => !isStoreEvent(e) && e.status === 'upcoming' && (e.endDate || e.startDate) >= today)
    .sort((a, b) => (a.endDate || a.startDate).localeCompare(b.endDate || b.startDate));
  return waiting[0] ?? null;
}

export interface TypeLabel {
  /** e.g. "Preorder · CF24", "Mail order", "Mail order · CF23 post-event" */
  title: string;
  /** e.g. "Pick up Day 2 (13 Dec)", "Ship after event", "Ships after CF24 (ends 13 Dec)" */
  detail: string;
  type: OrderType;
  held: Event | null;
}

export function typeLabelOf(o: Order, event: Event | undefined, batch: Batch | undefined, events: Event[]): TypeLabel {
  const type = orderTypeOf(o, batch, event);
  const code = event ? eventCode(event) : '?';
  if (type === 'preorder') {
    const detail = o.fulfilment === 'pickup' ? (o.pickupDay ? `Pick up ${o.pickupDay}` : 'Pick up at the booth') : 'Ship after event';
    return { title: `Preorder · ${code}`, detail, type, held: null };
  }
  const held = holdOf(o, type, events);
  const title = isStoreEvent(event) ? 'Mail order' : `Mail order · ${code} post-event`;
  const detail = held ? `Ships after ${eventCode(held)} (ends ${formatDate(held.endDate || held.startDate)})` : isUnfulfilled(o) ? 'Ready to ship' : 'Mail';
  return { title, detail, type, held };
}

/** Tab key on the Orders page: one per event and fulfilment for preorders, one for all mail orders. */
export function groupKeyOf(o: Order, type: OrderType): string {
  return type === 'mail_order' ? 'mail_order' : `preorder:${o.eventId}:${o.fulfilment}`;
}

export function trackingUrlFor(couriers: Courier[], courier: string, number: string): string | undefined {
  const c = couriers.find((x) => x.name === courier);
  if (!c?.trackingUrl || !number.trim()) return undefined;
  return c.trackingUrl.replace('{number}', encodeURIComponent(number.trim()));
}
