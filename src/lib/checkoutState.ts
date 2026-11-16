// What the shop checkout remembers between steps and across a page refresh, kept in sessionStorage.
// Pure: no React or Firebase, so the check script and the sandbox share it. The receipt file is
// never part of it (browsers cannot keep a chosen file across a reload).
import type { OrderType } from '@/types';

export type StepId = 'fulfilment' | 'details' | 'review' | 'payment';

export interface CheckoutState {
  /** The storefront lane the state belongs to; a stored state for another lane is ignored. */
  laneId: string;
  step: StepId;
  fulfilment: 'pickup' | 'mail';
  name: string;
  email: string;
  phone: string;
  /** Pick-up day, when the lane lists days. */
  day: string;
  notes: string;
  /** Shipped orders: destination postcode, address text and the chosen Lion service code. */
  postal: string;
  address: string;
  service: string;
  /** Payment choice, one of the catalogue's paymentChoices. */
  pay: string;
  /** Whether the checkout modal is showing. */
  open: boolean;
}

export const CHECKOUT_KEY = 'tsu.shop.checkout';
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The part of the Storage interface the checkout uses, so a Map can stand in for the check script. */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** The steps of one checkout: mail-order lanes already ship, so they skip the pick-up-or-mail question. */
export function stepsFor(kind: OrderType): StepId[] {
  return kind === 'preorder' ? ['fulfilment', 'details', 'review', 'payment'] : ['details', 'review', 'payment'];
}

export function emptyCheckout(laneId: string, kind: OrderType, defaultPay: string): CheckoutState {
  return {
    laneId, step: stepsFor(kind)[0], fulfilment: kind === 'preorder' ? 'pickup' : 'mail',
    name: '', email: '', phone: '', day: '', notes: '', postal: '', address: '', service: '', pay: defaultPay, open: false,
  };
}

const STRINGS = ['laneId', 'name', 'email', 'phone', 'day', 'notes', 'postal', 'address', 'service', 'pay'] as const;

/** The stored state for this lane, or a fresh one when nothing fits (other lane, bad JSON, missing storage). */
export function readCheckout(kv: KV | undefined, laneId: string, kind: OrderType, defaultPay: string): CheckoutState {
  const empty = emptyCheckout(laneId, kind, defaultPay);
  if (!kv) return empty;
  try {
    const raw = kv.getItem(CHECKOUT_KEY);
    if (!raw) return empty;
    const s = JSON.parse(raw) as Record<string, unknown>;
    if (!s || typeof s !== 'object' || s.laneId !== laneId) return empty;
    if (!STRINGS.every((k) => typeof s[k] === 'string')) return empty;
    if (typeof s.open !== 'boolean') return empty;
    if (s.fulfilment !== 'pickup' && s.fulfilment !== 'mail') return empty;
    if (!stepsFor(kind).includes(s.step as StepId)) return empty;
    const out: CheckoutState = { ...empty, open: s.open, fulfilment: s.fulfilment, step: s.step as StepId };
    for (const k of STRINGS) out[k] = s[k] as string;
    return out;
  } catch {
    return empty;
  }
}

/** Drops a pick-up day or payment choice that staff have removed since the state was stored. */
export function sanitizeCheckout(s: CheckoutState, o: { days: string[]; pays: string[]; defaultPay: string }): CheckoutState {
  const day = s.day && o.days.includes(s.day) ? s.day : '';
  const pay = s.pay && o.pays.includes(s.pay) ? s.pay : o.defaultPay;
  return day === s.day && pay === s.pay ? s : { ...s, day, pay };
}

export function writeCheckout(kv: KV | undefined, s: CheckoutState): void {
  try { kv?.setItem(CHECKOUT_KEY, JSON.stringify(s)); } catch { /* private mode or quota */ }
}

export function clearCheckout(kv: KV | undefined): void {
  try { kv?.removeItem(CHECKOUT_KEY); } catch { /* ignore */ }
}

export interface StepChecks {
  /** The lane lists pick-up days and the customer picks up. */
  needDay: boolean;
  shipped: boolean;
  /** Why the shipping is not ready yet (see shippingProblem), or '' when it is. */
  shippingProblem: string;
}

/** Field errors for the details step, keyed by field; empty when the step is complete. */
export function detailsProblems(s: CheckoutState, c: StepChecks): Record<string, string> {
  const e: Record<string, string> = {};
  if (!s.name.trim()) e.name = 'Required';
  if (!s.email.trim()) e.email = 'Required'; else if (!EMAIL_RE.test(s.email.trim())) e.email = 'That e-mail address does not look right.';
  if (!s.phone.trim()) e.phone = 'Required';
  if (c.needDay && !s.day) e.day = 'Choose a day';
  if (c.shipped) {
    if (!s.address.trim()) e.address = 'Required for shipping';
    if (c.shippingProblem) e.ship = c.shippingProblem;
  }
  return e;
}

/** The step a restored state may open on: never past details while the details are incomplete. */
export function clampStep(s: CheckoutState, kind: OrderType, c: StepChecks): StepId {
  const steps = stepsFor(kind);
  if (!steps.includes(s.step)) return steps[0];
  if ((s.step === 'review' || s.step === 'payment') && Object.keys(detailsProblems(s, c)).length > 0) return 'details';
  return s.step;
}
