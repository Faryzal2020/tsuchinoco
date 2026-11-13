'use client';

// Customer sign-in on the public pages. Booth pickups keep the anonymous session; an order that
// ships needs Google, so the customer can find it again on their order page later.
import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, type User } from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from './firebase';
import { fx } from './functions';
import type { ShippingCustomer, ShippingDeps } from './shippingQuote';

const asCustomer = (u: User | null): ShippingCustomer | null =>
  u && !u.isAnonymous && u.providerData.some((p) => p.providerId === 'google.com')
    ? { uid: u.uid, name: u.displayName ?? '', email: u.email ?? '' }
    : null;

/** Sign-in and quoting for the live shop and form pages. */
export function useShippingDeps(): ShippingDeps {
  const [customer, setCustomer] = useState<ShippingCustomer | null>(() => (isFirebaseConfigured ? asCustomer(auth.currentUser) : null));
  useEffect(() => (isFirebaseConfigured ? onAuthStateChanged(auth, (u) => setCustomer(asCustomer(u))) : undefined), []);
  return useMemo(() => ({
    customer,
    signIn: async () => {
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      let r;
      try { r = await signInWithPopup(auth, googleProvider); }
      catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
        if (code === 'auth/popup-blocked') throw new Error('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.');
        throw new Error('Could not sign in with Google. Try again.');
      }
      const c = asCustomer(r.user);
      setCustomer(c);
      return c;
    },
    quote: fx.quoteShipping,
  }), [customer]);
}
