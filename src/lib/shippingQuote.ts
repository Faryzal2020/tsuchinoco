'use client';

// The checkout side of shipping, shared by the storefront and the Forms: who the customer is
// (shipping needs a Google sign-in), the postcode, the quote from quoteShipping, the chosen service
// and what it adds to the total. No Firebase imports: the pages pass the sign-in and the call in
// as ShippingDeps, so the staff preview and the sandbox can stand in for them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { parcelForForm } from './shipping';
import type { OrderType, PublicForm, ShippingOption, ShippingQuoteResult } from '@/types';

export interface ShippingCustomer { uid: string; name: string; email: string }

export interface ShippingDeps {
  /** The Google-signed-in customer, or null. Anonymous sessions do not count. */
  customer: ShippingCustomer | null;
  signIn: () => Promise<ShippingCustomer | null>;
  quote: (req: { formId: string; postalCode: string; lines: Record<string, number> }) => Promise<ShippingQuoteResult>;
}

export type QuoteState = 'signin' | 'postcode' | 'loading' | 'ready' | 'none' | 'error';

export interface ShippingQuoteHook {
  state: QuoteState;
  postal: string;
  setPostal: (v: string) => void;
  result: ShippingQuoteResult | null;
  option: ShippingOption | null;
  setService: (service: string) => void;
  error: string;
  retry: () => void;
  /** Courier price plus handling and packaging, or 0 until a service is chosen. */
  extra: number;
  /** Charged kilograms of the current cart, worked out locally from the published weights. */
  billedKg: number;
  signIn: () => Promise<void>;
  signingIn: boolean;
}

const messageOf = (e: unknown, fallback: string): string => {
  const m = e instanceof Error ? e.message : '';
  // Firebase prefixes some messages with "FirebaseError: ".
  return m.replace(/^FirebaseError:\s*/, '') || fallback;
};

/**
 * Quote state for one checkout. Quotes again only when the postcode or the billed kilograms change,
 * so changing quantities within the same kilogram keeps the price on screen.
 */
export function useShippingQuote({ deps, form, lines, active, onSignedIn }: {
  deps: ShippingDeps | undefined;
  form: Pick<PublicForm, 'formId' | 'items' | 'maxQtyPerLine'>;
  lines: Record<string, number>;
  /** False while the customer picks up, or the cart is empty: nothing is quoted. */
  active: boolean;
  onSignedIn?: (c: ShippingCustomer) => void;
}): ShippingQuoteHook {
  const [postal, setPostalRaw] = useState('');
  const [result, setResult] = useState<ShippingQuoteResult | null>(null);
  const [service, setService] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);

  const parcel = useMemo(() => parcelForForm(form, lines), [form, lines]);
  const billedKg = 'error' in parcel ? 0 : parcel.billedKg;
  const customer = deps?.customer ?? null;
  const postalOk = /^[1-9]\d{4}$/.test(postal);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  // Depends on the quote function, not the deps object, which pages may rebuild on every render.
  const quoteFn = deps?.quote;
  const signedIn = !!customer;
  useEffect(() => {
    if (!quoteFn || !active || !signedIn || !postalOk || billedKg === 0) return;
    const my = ++seq.current;
    setLoading(true);
    setError('');
    const t = setTimeout(() => {
      quoteFn({ formId: form.formId, postalCode: postal, lines: linesRef.current })
        .then((r) => { if (my === seq.current) setResult(r); })
        .catch((e) => { if (my === seq.current) { setResult(null); setError(messageOf(e, 'Could not get shipping prices. Try again.')); } })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 350);
    return () => clearTimeout(t);
  }, [quoteFn, active, signedIn, postalOk, postal, billedKg, form.formId, attempt]);

  // A stale answer (other postcode or weight) never shows next to the new input.
  const current = result && result.postalCode === postal && result.billedKg === billedKg ? result : null;
  const option = current?.options.find((o) => o.service === service) ?? current?.options[0] ?? null;
  const extra = option && current ? option.price + current.handlingFee + current.packagingFee : 0;

  const state: QuoteState = !customer ? 'signin' : !postalOk ? 'postcode' : loading ? 'loading' : error ? 'error' : !current ? 'loading' : current.options.length === 0 ? 'none' : 'ready';

  return {
    state, postal, result: current, option, error, extra, billedKg, signingIn,
    setPostal: (v) => setPostalRaw(v.replace(/\D/g, '').slice(0, 5)),
    setService,
    retry: () => setAttempt((n) => n + 1),
    signIn: async () => {
      if (!deps) return;
      setSigningIn(true);
      setError('');
      try { const c = await deps.signIn(); if (c) onSignedIn?.(c); }
      catch (e) { setError(messageOf(e, 'Could not sign in. Try again.')); }
      finally { setSigningIn(false); }
    },
  };
}

/** When the parcel leaves, as the checkout states it. */
export function shipRule(kind: OrderType): string {
  return kind === 'preorder'
    ? 'Ships at least 2 weeks after the event ends.'
    : 'Ships at least 2 weeks after your payment is confirmed, or 2 weeks after an upcoming event ends if that is later.';
}
