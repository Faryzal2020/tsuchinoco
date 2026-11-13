// The customer's view of an order: what the order page and the order history show. Pure, with
// relative value imports, so the Cloud Function that writes customerOrders/{token} and the
// sandbox build exactly the same copy.
import { variantLabel } from './keys';
import { eventCode } from './forms';
import type { Batch, CustomerOrder, CustomerStage, Event, Item, Order } from '../types';

/** The public site; order links in e-mails point here, never at the staff host. */
export const PUBLIC_ORIGIN = 'https://tsuchinoco.xyz';
export const orderPagePath = (token: string) => `/shop/order/?t=${encodeURIComponent(token)}`;
export const orderPageUrl = (token: string) => `${PUBLIC_ORIGIN}${orderPagePath(token)}`;
export const ORDER_HISTORY_PATH = '/shop/orders/';

export function customerStageOf(o: Pick<Order, 'status' | 'payment'>): CustomerStage {
  if (o.status === 'cancelled' || o.status === 'shipped' || o.status === 'collected' || o.status === 'not_collected') return o.status;
  return o.payment === 'paid' ? 'paid' : 'unpaid';
}

export const STAGE_LABELS: Record<CustomerStage, string> = {
  unpaid: 'Waiting for payment', paid: 'Paid', shipped: 'Shipped', collected: 'Picked up', not_collected: 'Not picked up', cancelled: 'Cancelled',
};

/** The copy written to customerOrders. Only what the customer may see; no contact details. */
export function customerOrderView(o: Order, ctx: { event?: Event; batch?: Batch; itemsById: Map<string, Item>; currency: string }): CustomerOrder {
  const isMail = o.orderType === 'mail_order' || ctx.event?.kind === 'store' || ctx.batch?.mode === 'post';
  const title = isMail
    ? (ctx.event?.kind === 'store' || !ctx.event ? 'Mail order' : `Mail order · ${eventCode(ctx.event)}`)
    : `Preorder · ${ctx.event?.name ?? 'event'}`;
  const lines = o.rawLines.map((l) => ({ label: variantLabel(ctx.itemsById.get(l.itemId), l.variantId ?? 'default'), qty: l.qty, lineTotal: l.lineTotal }));
  const s = o.fulfilment === 'mail' ? o.shipping : undefined;
  return {
    ...(o.customerUid ? { uid: o.customerUid } : {}),
    orderNumber: o.transactionId ?? '', submittedAt: o.submittedAt, orderType: isMail ? 'mail_order' : 'preorder', title,
    fulfilment: o.fulfilment, ...(o.fulfilment === 'pickup' && o.pickupDay ? { pickupDay: o.pickupDay } : {}),
    stage: customerStageOf(o),
    ...(o.paidAt ? { paidAt: o.paidAt } : {}), ...(o.shippedAt ? { shippedAt: o.shippedAt } : {}),
    ...(o.collectedAt ? { collectedAt: o.collectedAt } : {}), ...(o.cancelledAt ? { cancelledAt: o.cancelledAt } : {}),
    lines, itemsTotal: lines.reduce((n, l) => n + l.lineTotal, 0),
    ...(s ? { shipping: { name: s.name, fee: s.fee, handlingFee: s.handlingFee, packagingFee: s.packagingFee, billedKg: s.billedKg } } : {}),
    total: o.total, currency: ctx.currency,
    ...(o.tracking?.number ? { tracking: { courier: o.tracking.courier, number: o.tracking.number, ...(o.tracking.url ? { url: o.tracking.url } : {}) } } : {}),
    updatedAt: o.updatedAt,
  };
}

/** The order fields the customer copy depends on, to skip rewriting it when only staff data changed. */
export const customerViewKey = (o: Order): string => JSON.stringify([
  o.transactionId, o.status, o.payment, o.paidAt, o.shippedAt, o.collectedAt, o.cancelledAt, o.rawLines, o.total,
  o.shipping, o.tracking, o.customerUid, o.customerToken, o.pickupDay, o.fulfilment, o.orderType, o.eventId, o.batchId,
]);
