// Order-update e-mails: which updates send one, the built-in text, and filling a template with an
// order's details. Pure, shared by the Cloud Function that sends them and the Settings preview.
import type { Batch, Event, Item, NotificationSetting, NotificationType, Order, Settings } from '../types';
import { variantLabel } from './keys';
import { eventCode } from './forms';
import { orderPageUrl } from './customerOrders';

export const NOTIFICATION_TYPES: NotificationType[] = ['received', 'paid', 'delivered'];

export const NOTIFICATION_LABELS: Record<NotificationType, { title: string; when: string }> = {
  received: { title: 'Order received', when: 'When a Form or storefront order comes in. Manual orders never send it.' },
  paid: { title: 'Payment confirmed', when: 'When staff mark the order paid.' },
  delivered: { title: 'Delivered with tracking', when: 'When staff mark the order delivered. Carries the courier and tracking number.' },
};

/** All switched off until staff turn them on. */
export const notificationsOf = (s: Pick<Settings, 'notifications'>): Record<NotificationType, NotificationSetting> => ({
  received: { on: false, ...(s.notifications?.received ?? {}) },
  paid: { on: false, ...(s.notifications?.paid ?? {}) },
  delivered: { on: false, ...(s.notifications?.delivered ?? {}) },
});

/** The change an e-mail belongs to, so a retried trigger never sends the same update twice. */
export const emailRef = (o: Pick<Order, 'createdAt' | 'paidAt' | 'shippedAt'>, type: NotificationType): number =>
  (type === 'received' ? o.createdAt : type === 'paid' ? o.paidAt : o.shippedAt) ?? 0;

/** Which automatic e-mails an order write calls for. */
export function emailsDue(before: Order | null, after: Order): NotificationType[] {
  const due: NotificationType[] = [];
  if (!before && (after.source === 'web' || after.source === 'store')) due.push('received');
  if (before && before.payment !== 'paid' && after.payment === 'paid') due.push('paid');
  if (before && before.status !== 'shipped' && after.status === 'shipped') due.push('delivered');
  return due;
}

export const BUILTIN_TEMPLATES: Record<NotificationType, { subject: string; html: string }> = {
  received: {
    subject: 'We received your order {{orderNumber}}',
    html: `<p>Hi {{name}},</p>
<p>Thank you! We received your order <strong>{{orderNumber}}</strong> ({{orderType}}).</p>
{{items}}
<p><strong>Total: {{total}}</strong><br/>{{fulfilment}}</p>
<p>We confirm every payment by hand and will e-mail you once yours is checked.</p>
<p>Tsuchinoco</p>`,
  },
  paid: {
    subject: 'Payment confirmed for {{orderNumber}}',
    html: `<p>Hi {{name}},</p>
<p>Your payment for order <strong>{{orderNumber}}</strong> is confirmed.</p>
{{items}}
<p><strong>Total: {{total}}</strong><br/>{{fulfilment}}</p>
<p>{{orderLink}}</p>
<p>Tsuchinoco</p>`,
  },
  delivered: {
    subject: 'Your order {{orderNumber}} is on its way',
    html: `<p>Hi {{name}},</p>
<p>Your order <strong>{{orderNumber}}</strong> has been handed to {{courier}}.</p>
<p>Tracking number: <strong>{{trackingLink}}</strong></p>
{{items}}
<p>{{orderLink}}</p>
<p>Tsuchinoco</p>`,
  },
};

export const PLACEHOLDERS = ['name', 'orderNumber', 'orderType', 'event', 'items', 'itemsTotal', 'shipping', 'shippingFee', 'handlingFee', 'packagingFee', 'total', 'fulfilment', 'pickupDay', 'paymentMethod', 'courier', 'trackingNumber', 'trackingUrl', 'trackingLink', 'orderLink', 'orderUrl'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number, currency: string) => `${currency} ${Math.round(n).toLocaleString('en-US')}`;

/** Placeholder values for one order. Everything is HTML-escaped; `items` and `trackingLink` are ready-made HTML. */
export function orderEmailVars(o: Order, ctx: { event?: Event; batch?: Batch; itemsById: Map<string, Item>; currency: string }): Record<string, string> {
  const code = ctx.event ? eventCode(ctx.event) : '';
  const isMail = o.orderType === 'mail_order' || ctx.event?.kind === 'store' || ctx.batch?.mode === 'post';
  const orderType = isMail ? (ctx.event?.kind === 'store' ? 'Mail order' : `Mail order · ${code}`) : `Preorder · ${ctx.event?.name ?? code}`;
  const fulfilment = o.fulfilment === 'pickup'
    ? `Pick up at the booth${o.pickupDay ? `, ${o.pickupDay}` : ''}${ctx.event && ctx.event.kind !== 'store' ? ` (${ctx.event.name})` : ''}.`
    : isMail ? 'Shipped to your address.' : 'Shipped to your address after the event.';
  const rows = o.rawLines.map((l) => {
    const label = variantLabel(ctx.itemsById.get(l.itemId), l.variantId ?? 'default');
    return `<tr><td style="padding:2px 12px 2px 0">${l.qty} × ${esc(label)}</td><td style="padding:2px 0;text-align:right">${esc(money(l.lineTotal, ctx.currency))}</td></tr>`;
  }).join('');
  // Shipping sits under the items, so templates that only use {{items}} and {{total}} still add up.
  const s = o.fulfilment === 'mail' ? o.shipping : undefined;
  const extraRow = (label: string, n: number) => (n > 0 ? `<tr><td style="padding:2px 12px 2px 0">${esc(label)}</td><td style="padding:2px 0;text-align:right">${esc(money(n, ctx.currency))}</td></tr>` : '');
  const shipRows = s ? extraRow(`Shipping · ${s.name}${s.billedKg ? ` · ${s.billedKg} kg` : ''}`, s.fee) + extraRow('Handling', s.handlingFee) + extraRow('Packaging', s.packagingFee) : '';
  const itemsTotal = o.rawLines.reduce((n, l) => n + l.lineTotal, 0);
  const t = o.tracking;
  const trackingLink = t?.number ? (t.url ? `<a href="${esc(t.url)}">${esc(t.number)}</a>` : esc(t.number)) : '';
  const plain: Record<string, string> = {
    name: o.customer.name, email: o.customer.email, orderNumber: o.transactionId ?? '', orderType, event: ctx.event?.kind === 'store' ? 'Mail order' : ctx.event?.name ?? '',
    batch: ctx.batch ? String(ctx.batch.number) : '', total: money(o.total, ctx.currency), fulfilment, pickupDay: o.pickupDay ?? '', paymentMethod: o.paymentMethod ?? '',
    courier: t?.courier ?? '', trackingNumber: t?.number ?? '', trackingUrl: t?.url ?? '',
    itemsTotal: money(itemsTotal, ctx.currency),
    shipping: s ? `${s.name}, ${money(s.fee, ctx.currency)}` : '',
    shippingFee: s ? money(s.fee, ctx.currency) : '', handlingFee: s ? money(s.handlingFee, ctx.currency) : '', packagingFee: s ? money(s.packagingFee, ctx.currency) : '',
    orderUrl: o.customerToken ? orderPageUrl(o.customerToken) : '',
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(plain)) out[k] = esc(v);
  out.items = `<table style="border-collapse:collapse">${rows}${shipRows}</table>`;
  out.trackingLink = trackingLink;
  // Ready-made link to the customer's order page; empty until the order has its token.
  out.orderLink = o.customerToken ? `<a href="${esc(orderPageUrl(o.customerToken))}">Follow your order online</a>` : '';
  return out;
}

/** Fill {{placeholders}}. The subject is plain text, so its values are unescaped. */
export function renderEmail(tpl: { subject: string; html: string }, vars: Record<string, string>): { subject: string; html: string } {
  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  const fill = (s: string, plain: boolean) => s.replace(/{{\s*(\w+)\s*}}/g, (_, k: string) => (k in vars ? (plain ? unesc(vars[k]).replace(/<[^>]*>/g, '') : vars[k]) : ''));
  return { subject: fill(tpl.subject, true), html: fill(tpl.html, false) };
}

/** The template staff picked for an update, or the built-in one. */
export function templateFor(type: NotificationType, settings: Pick<Settings, 'notifications' | 'emailTemplates'>): { subject: string; html: string } {
  const id = notificationsOf(settings)[type].templateId;
  const t = id ? settings.emailTemplates?.find((x) => x.id === id) : undefined;
  return t ? { subject: t.subject, html: t.html } : BUILTIN_TEMPLATES[type];
}
