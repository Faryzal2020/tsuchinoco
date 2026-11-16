'use client';

// Pieces the shop page, the cart panel and the checkout modal share: priced lines, the quantity
// stepper, a labelled text field, and the Google sign-in / postcode / Lion services block.
import React from 'react';
import type { StoreProduct, StoreVariant } from '@/types';
import type { StorePrice } from '@/lib/store';
import { formatMoney } from '@/lib/format';
import type { ShippingQuoteHook } from '@/lib/shippingQuote';

export interface Priced { variant: StoreVariant; product: StoreProduct; price: StorePrice; orderable: boolean }

export interface Line { key: string; qty: number; p?: Priced }

export function Stepper({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="shop-stepper" role="group" aria-label={`Quantity of ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} aria-label="One less">−</button>
      <span className="shop-money" aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="One more">+</button>
    </div>
  );
}

/** Why a shipped order cannot be placed yet, or '' when the shipping is ready. */
export function shippingProblem(q: ShippingQuoteHook, live: boolean): string {
  if (!live) return 'Shipping prices only work on the live shop.';
  switch (q.state) {
    case 'signin': return 'Sign in with Google to have your order shipped.';
    case 'postcode': return 'Enter your five-digit postcode.';
    case 'loading': return 'Wait a moment for the shipping price.';
    case 'none': return 'Lion Parcel does not deliver to this postcode.';
    case 'error': return q.error || 'Could not get shipping prices.';
    default: return q.option ? '' : 'Choose a shipping service.';
  }
}

/** Google sign-in, postcode and the Lion services for a shipped order. */
export function ShopShipping({ q, live, currency, error }: { q: ShippingQuoteHook; live: boolean; currency: string; error?: string }) {
  if (!live) return <p className="shop-hint">Customers sign in with Google here and get Lion Parcel prices for their postcode. The preview cannot fetch prices.</p>;
  if (q.state === 'signin') {
    return (
      <div className="shop-signin">
        <p><b>Sign in with Google to ship this order.</b> You can follow it later from your order page. Picking up at the booth needs no sign-in.</p>
        <button type="button" className="shop-btn" onClick={q.signIn} disabled={q.signingIn}>{q.signingIn ? 'Signing in…' : 'Sign in with Google'}</button>
        {(q.error || error) && <span className="shop-error">{q.error || error}</span>}
      </div>
    );
  }
  return (
    <div className="shop-shipping">
      <div className="shop-field shop-postcode">
        <label htmlFor="shop-postcode">Postcode</label>
        <input id="shop-postcode" inputMode="numeric" autoComplete="postal-code" maxLength={5} placeholder="e.g. 16920" value={q.postal} onChange={(e) => q.setPostal(e.target.value)} aria-invalid={q.state === 'postcode' && !!error} />
      </div>
      {q.state === 'loading' && <p className="shop-hint" aria-live="polite">Checking Lion Parcel prices…</p>}
      {q.state === 'none' && <p className="shop-error">Lion Parcel does not deliver to this postcode. Check it, or contact us.</p>}
      {q.state === 'error' && <p className="shop-error">{q.error} <button type="button" className="shop-link" onClick={q.retry}>Try again</button></p>}
      {q.state === 'ready' && q.result && (
        <div className="shop-radios" role="radiogroup" aria-label="Shipping service">
          {q.result.options.map((o) => (
            <label key={o.service} className={`shop-option ${q.option?.service === o.service ? 'is-on' : ''}`}>
              <input type="radio" name="ship" checked={q.option?.service === o.service} onChange={() => q.setService(o.service)} />
              <b>{o.name} · <span className="shop-money">{formatMoney(o.price, currency)}</span></b>
              <span>{o.etd ? `${o.etd} after it ships` : 'Delivery time varies'} · charged as {q.result!.billedKg} kg</span>
            </label>
          ))}
        </div>
      )}
      {error && q.state !== 'loading' && q.state !== 'none' && q.state !== 'error' && <span className="shop-error">{error}</span>}
    </div>
  );
}

export function Text({ id, label, value, onChange, error, type = 'text', autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; type?: string; autoComplete?: string }) {
  return (
    <div className="shop-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} autoComplete={autoComplete} />
      {error && <span className="shop-error">{error}</span>}
    </div>
  );
}
