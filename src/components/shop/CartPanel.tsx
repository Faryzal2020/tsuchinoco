'use client';

// The cart beside the catalogue: a drawer on the right on desktop, a sheet from the bottom on phones.
// Collapsed, only the handle (the one icon on the page) stays, out of the way of the products.
// Pure UI: lines and callbacks come in, "Checkout" goes out. Remembering open/closed is the page's job.
import React from 'react';
import type { StoreChoice } from '@/lib/store';
import { formatMoney } from '@/lib/format';
import { Stepper, type Line } from './parts';

export const PANEL_KEY = 'tsu.shop.panel';

export interface CartPanelProps {
  currency: string;
  choice: StoreChoice;
  okLines: Line[];
  badLines: Line[];
  total: number;
  max: number;
  setQty: (key: string, qty: number) => void;
  removeBad: () => void;
  open: boolean;
  onToggle: (open: boolean) => void;
  onCheckout: () => void;
  preview?: boolean;
}

function CartIcon() {
  return (
    <svg className="shop-cart-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.3h8.8a1.5 1.5 0 0 0 1.5-1.2L21 8H6.2" />
      <circle cx="9.5" cy="20" r="1.2" />
      <circle cx="17" cy="20" r="1.2" />
    </svg>
  );
}

export default function CartPanel({ currency, choice, okLines, badLines, total, max, setQty, removeBad, open, onToggle, onCheckout }: CartPanelProps) {
  const count = okLines.reduce((s, l) => s + l.qty, 0);
  const empty = okLines.length === 0;
  const blocked = empty || badLines.length > 0;
  return (
    <aside className={`shop-cart ${open ? 'is-open' : ''}`} aria-label="Cart">
      <button type="button" className="shop-cart-handle" aria-expanded={open} aria-controls="shop-cart-body" onClick={() => onToggle(!open)}>
        <CartIcon />
        <span className="shop-cart-count shop-money">{count}</span>
        <span className="sr-only">Cart, {count} {count === 1 ? 'item' : 'items'}</span>
      </button>
      <div id="shop-cart-body" className="shop-cart-body">
        <div className="shop-cart-head">
          <h2>Cart</h2>
          <span className="shop-hint">{choice.label}</span>
        </div>
        {empty && badLines.length === 0 ? <p className="shop-hint">Your cart is empty.</p> : (
          <ul className="shop-lines">
            {okLines.map((l) => (
              <li key={l.key}>
                <div><b>{l.p!.product.name}</b>{l.p!.variant.name && <span className="shop-line-variant"> · {l.p!.variant.name}</span>}<div className="shop-hint shop-money">{formatMoney(l.p!.price.unitPrice, currency)} each</div></div>
                <Stepper value={l.qty} max={max} onChange={(v) => setQty(l.key, v)} label={l.p!.product.name} />
                <span className="shop-money shop-line-total">{formatMoney(l.qty * l.p!.price.unitPrice, currency)}</span>
              </li>
            ))}
            {badLines.map((l) => (
              <li key={l.key} className="is-out">
                <div><b>{l.p!.product.name}</b>{l.p!.variant.name && <span className="shop-line-variant"> · {l.p!.variant.name}</span>}<div className="shop-warn">Not available for this order</div></div>
                <button type="button" className="shop-link" onClick={() => setQty(l.key, 0)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {badLines.length > 0 && <button type="button" className="shop-btn" onClick={removeBad}>Remove unavailable items</button>}
        <div className="shop-total"><span>Items</span><span className="shop-money">{formatMoney(total, currency)}</span></div>
      </div>
      <div className="shop-cart-foot">
        <button type="button" className="shop-btn shop-btn-primary" disabled={blocked} onClick={onCheckout}>Checkout</button>
        <button type="button" className="shop-btn" onClick={() => onToggle(false)}>Keep shopping</button>
        {blocked && <span className="shop-hint">{empty ? 'Your cart is empty.' : 'Remove the unavailable items first.'}</span>}
      </div>
    </aside>
  );
}
