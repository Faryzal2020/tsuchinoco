'use client';

// One order as the customer sees it (the order page), and the list on the order history page.
// Pure UI over CustomerOrder, styled by shop.css inside a .shop root.
import React from 'react';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { STAGE_LABELS } from '@/lib/customerOrders';
import type { CustomerOrder, CustomerStage } from '@/types';

/** The steps an order goes through, for the progress line. */
function stepsOf(o: CustomerOrder): { label: string; at?: number; done: boolean }[] {
  const end = o.fulfilment === 'mail'
    ? { label: 'Shipped', at: o.shippedAt, done: o.stage === 'shipped' }
    : { label: 'Picked up', at: o.collectedAt, done: o.stage === 'collected' };
  return [
    { label: 'Ordered', at: o.submittedAt, done: true },
    { label: 'Paid', at: o.paidAt, done: !!o.paidAt || o.stage === 'paid' || end.done },
    end,
  ];
}

const STAGE_NOTES: Partial<Record<CustomerStage, (o: CustomerOrder) => string>> = {
  unpaid: () => 'We confirm every payment by hand. This page updates once yours is checked.',
  paid: (o) => (o.fulfilment === 'mail'
    ? (o.orderType === 'preorder' ? 'Your parcel ships at least 2 weeks after the event ends.' : 'Your parcel ships at least 2 weeks after your payment was confirmed.')
    : `Pick it up at the booth${o.pickupDay ? ` on ${o.pickupDay}` : ''}. Show your order number.`),
  not_collected: () => 'This order was not picked up at the event. Contact us to arrange shipping.',
  cancelled: () => 'This order was cancelled. Contact us if that is a surprise.',
};

export function StagePill({ stage }: { stage: CustomerStage }) {
  return <span className={`shop-stage shop-stage-${stage}`}>{STAGE_LABELS[stage]}</span>;
}

export default function CustomerOrderCard({ order: o }: { order: CustomerOrder }) {
  const money = (n: number) => formatMoney(n, o.currency);
  const note = STAGE_NOTES[o.stage]?.(o);
  return (
    <section className="shop-thanks shop-order" aria-label={`Order ${o.orderNumber}`}>
      <div className="shop-order-head">
        <div>
          <div className="shop-code-label">{o.title}</div>
          <h2>Order {o.orderNumber || '(number pending)'}</h2>
          <p className="shop-hint">Placed {formatDateTime(o.submittedAt)}</p>
        </div>
        <StagePill stage={o.stage} />
      </div>

      {o.stage !== 'cancelled' && o.stage !== 'not_collected' && (
        <ol className="shop-steps">
          {stepsOf(o).map((s) => (
            <li key={s.label} className={s.done ? 'is-done' : ''}>
              <b>{s.label}</b>
              <span>{s.done && s.at ? formatDate(s.at) : ''}</span>
            </li>
          ))}
        </ol>
      )}
      {note && <p className="shop-paytext">{note}</p>}

      {o.tracking && (
        <div className="shop-tracking">
          <span>{o.tracking.courier} · <span className="shop-money">{o.tracking.number}</span></span>
          {o.tracking.url && <a className="shop-btn" href={o.tracking.url} target="_blank" rel="noopener noreferrer">Track the parcel</a>}
        </div>
      )}

      <ul className="shop-lines">
        {o.lines.map((l, i) => (
          <li key={i}><div><b>{l.label}</b></div><span>{l.qty} ×</span><span className="shop-money shop-line-total">{money(l.lineTotal)}</span></li>
        ))}
      </ul>
      {o.shipping && (
        <div className="shop-breakdown">
          <div><span>Items</span><span className="shop-money">{money(o.itemsTotal)}</span></div>
          <div><span>Shipping · {o.shipping.name}{o.shipping.billedKg ? ` · ${o.shipping.billedKg} kg` : ''}</span><span className="shop-money">{money(o.shipping.fee)}</span></div>
          {o.shipping.handlingFee > 0 && <div><span>Handling</span><span className="shop-money">{money(o.shipping.handlingFee)}</span></div>}
          {o.shipping.packagingFee > 0 && <div><span>Packaging</span><span className="shop-money">{money(o.shipping.packagingFee)}</span></div>}
        </div>
      )}
      <div className="shop-total"><span>Total</span><span className="shop-money">{money(o.total)}</span></div>
      <p className="shop-hint">{o.fulfilment === 'mail' ? 'Shipped to the address you gave at checkout.' : `Pick up at the booth${o.pickupDay ? `, ${o.pickupDay}` : ''}.`} Updated {formatDateTime(o.updatedAt)}.</p>
    </section>
  );
}

/** The order history: newest first, each row opening its order page. */
export function CustomerOrderList({ orders, hrefFor, onOpen }: { orders: { token: string; order: CustomerOrder }[]; hrefFor?: (token: string) => string; onOpen?: (token: string) => void }) {
  const sorted = [...orders].sort((a, b) => b.order.submittedAt - a.order.submittedAt);
  return (
    <ul className="shop-order-list">
      {sorted.map(({ token, order: o }) => {
        const count = o.lines.reduce((n, l) => n + l.qty, 0);
        const body = (
          <>
            <span className="shop-order-list-main">
              <b>{o.orderNumber || 'Order'}</b>
              <span className="shop-hint">{o.title} · {formatDate(o.submittedAt)} · {count} {count === 1 ? 'item' : 'items'}</span>
            </span>
            <StagePill stage={o.stage} />
            <span className="shop-money">{formatMoney(o.total, o.currency)}</span>
          </>
        );
        return (
          <li key={token}>
            {onOpen ? <button type="button" onClick={() => onOpen(token)}>{body}</button> : <a href={hrefFor?.(token) ?? '#'}>{body}</a>}
          </li>
        );
      })}
    </ul>
  );
}
