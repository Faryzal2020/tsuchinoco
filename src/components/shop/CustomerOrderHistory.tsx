'use client';

// The "My orders" page body, shared by the live page and the sandbox.
import React, { useState } from 'react';
import { CustomerOrderList } from './CustomerOrderCard';
import type { ShippingDeps } from '@/lib/shippingQuote';
import type { CustomerOrder } from '@/types';
import './shop.css';

export default function CustomerOrderHistory({ deps, orders, error, hrefFor, onOpen, shopHref }: {
  deps: ShippingDeps;
  /** null while signed out or loading */
  orders: { token: string; order: CustomerOrder }[] | null;
  error?: string;
  hrefFor?: (token: string) => string;
  onOpen?: (token: string) => void;
  shopHref: string;
}) {
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState('');
  const signIn = async () => {
    setSigningIn(true); setSignInError('');
    try { await deps.signIn(); } catch (e) { setSignInError(e instanceof Error ? e.message : 'Could not sign in.'); } finally { setSigningIn(false); }
  };
  return (
    <div className="shop">
      <nav className="shop-head" aria-label="Shop"><a className="shop-nav-link" href={shopHref}>Back to the shop</a></nav>
      <section className="shop-thanks shop-order">
        <h2>My orders</h2>
        {!deps.customer ? (
          <div className="shop-signin">
            <p><b>Sign in with Google to see your orders.</b> Orders you had shipped are listed under the Google account you used at checkout.</p>
            <button type="button" className="shop-btn" onClick={signIn} disabled={signingIn}>{signingIn ? 'Signing in…' : 'Sign in with Google'}</button>
            {signInError && <span className="shop-error">{signInError}</span>}
          </div>
        ) : (
          <>
            <p className="shop-hint">Signed in as {deps.customer.email}. <button type="button" className="shop-link" onClick={signIn}>Use another account</button></p>
            {error ? <p className="shop-error">{error}</p> : orders === null ? <p className="shop-hint">Loading…</p> : orders.length === 0 ? (
              <p>No orders under this account yet.</p>
            ) : <CustomerOrderList orders={orders} hrefFor={hrefFor} onOpen={onOpen} />}
          </>
        )}
        <p className="shop-hint">Booth pickups need no sign-in, so they are not listed here: open them from the link in your payment e-mail.</p>
      </section>
    </div>
  );
}
