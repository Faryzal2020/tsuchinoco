// Shipping prices at checkout (Lion Parcel through Biteship).
// - quoteShipping: the checkout sends a postcode and its cart; the server weighs the cart from the
//   published form, asks Biteship for Lion's prices (or reuses one from the last 24 hours), and
//   stores the answer as shippingQuotes/{id}. The import charges what that quote says.
// Biteship charges Rp5 per rates call on a live key. A price is cached per origin, destination
// and billed kg, each customer gets QUOTES_PER_HOUR quotes, and BITESHIP_CALLS_PER_DAY caps the
// spend for the whole shop (Rp5 × 1,000 = Rp5.000 a day at most).
import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { clean, db, getSettings } from './common';
import { feesFor, optionsFromRates, orderShippingFrom, parcelForForm, QUOTE_TTL_MS, RATE_CACHE_MS, resolveShipping, SHIPPING_COURIER, shippingOf, unweighedFlag, validPostalCode, type CourierRate } from '../../src/lib/shipping';
import type { OrderShipping, PublicForm, Settings, ShippingOption, ShippingQuote, ShippingQuoteResult, Submission } from '../../src/types';

/** Set with `firebase functions:secrets:set BITESHIP_KEY`. BITESHIP_KEY in an env file works locally. */
const biteshipSecret = defineSecret('BITESHIP_KEY');
const biteshipKey = (): string => {
  try { return biteshipSecret.value() || process.env.BITESHIP_KEY || ''; } catch { return process.env.BITESHIP_KEY || ''; }
};

const QUOTES_PER_HOUR = 30;
const BITESHIP_CALLS_PER_DAY = 1000;
/** Declared value of the parcel. Rates do not depend on it unless insurance is asked for, which it is not. */
const DECLARED_VALUE = 100000;

/** Lion's prices from Biteship for one parcel of `kg` whole kilograms; [] where Lion does not deliver. */
export async function fetchLionRates(key: string, origin: string, destination: string, kg: number): Promise<ShippingOption[]> {
  if (!key) throw new HttpsError('failed-precondition', 'Shipping prices are not set up yet.');
  let res: Response;
  try {
    res = await fetch('https://api.biteship.com/v1/rates/couriers', {
      method: 'POST',
      headers: { authorization: key, 'content-type': 'application/json' },
      body: JSON.stringify({
        origin_postal_code: Number(origin),
        destination_postal_code: Number(destination),
        couriers: SHIPPING_COURIER,
        items: [{ name: 'Parcel', value: DECLARED_VALUE, weight: kg * 1000, quantity: 1 }],
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    logger.error('[shipping] Biteship unreachable', e);
    throw new HttpsError('unavailable', 'Could not reach the courier. Try again in a minute.');
  }
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; code?: number; pricing?: CourierRate[] };
  if (body.success) return optionsFromRates(body.pricing);
  // "No courier available for requested location": Lion does not deliver there (or is switched off).
  if (/no courier available/i.test(body.error ?? '')) return [];
  logger.error('[shipping] Biteship refused', { status: res.status, code: body.code, error: body.error });
  if (/postal|area|location/i.test(body.error ?? '')) throw new HttpsError('invalid-argument', 'The courier does not recognise that postcode.');
  throw new HttpsError('unavailable', 'The courier could not price this parcel right now. Try again in a minute.');
}

/** Counts one use in limits/{id} for the current window; false when the limit is reached. */
async function take(id: string, windowMs: number, limit: number, now: number): Promise<boolean> {
  const ref = db().doc(`shippingLimits/${id}`);
  return db().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() as { windowStart?: number; count?: number } | undefined;
    const fresh = !d?.windowStart || now - d.windowStart >= windowMs;
    const count = fresh ? 0 : d?.count ?? 0;
    if (count >= limit) return false;
    tx.set(ref, { windowStart: fresh ? now : d!.windowStart, count: count + 1 });
    return true;
  });
}

/** Lion's prices for a route and weight: from the cache when fresh, else from Biteship (counted against the daily cap). */
export async function lionRates(origin: string, destination: string, kg: number, now = Date.now()): Promise<ShippingOption[]> {
  const ref = db().doc(`shippingRates/${origin}_${destination}_${kg}`);
  const cached = (await ref.get()).data() as { options: ShippingOption[]; fetchedAt: number } | undefined;
  if (cached && now - cached.fetchedAt < RATE_CACHE_MS) return cached.options;
  const day = new Date(now + 7 * 3600_000).toISOString().slice(0, 10); // Jakarta date
  if (!(await take(`biteship_${day}`, 24 * 3600_000, BITESHIP_CALLS_PER_DAY, now))) {
    logger.error('[shipping] daily Biteship cap reached', { day });
    throw new HttpsError('resource-exhausted', 'Shipping prices are busy right now. Try again later or contact us.');
  }
  const options = await fetchLionRates(biteshipKey(), origin, destination, kg);
  await ref.set({ origin, destination, kg, options, fetchedAt: now });
  return options;
}

export const quoteShipping = onCall({ secrets: [biteshipSecret], cors: true, invoker: 'public' }, async (req): Promise<ShippingQuoteResult> => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (req.auth?.token.firebase?.sign_in_provider !== 'google.com') throw new HttpsError('permission-denied', 'Sign in with Google to have your order shipped.');

  const { formId, postalCode, lines } = (req.data ?? {}) as { formId?: unknown; postalCode?: unknown; lines?: unknown };
  const postal = typeof postalCode === 'string' ? postalCode.trim() : '';
  if (!validPostalCode(postal)) throw new HttpsError('invalid-argument', 'Enter a five-digit postcode.');
  if (typeof formId !== 'string' || !formId || formId.length > 40 || formId.includes('/')) throw new HttpsError('invalid-argument', 'Unknown form.');

  const now = Date.now();
  if (!(await take(`user_${uid}`, 3600_000, QUOTES_PER_HOUR, now))) throw new HttpsError('resource-exhausted', 'Too many shipping checks. Try again in an hour.');

  const pfSnap = await db().doc(`publicForms/${formId}`).get();
  const pf = pfSnap.exists ? (pfSnap.data() as PublicForm) : undefined;
  if (!pf || !pf.enabled) throw new HttpsError('failed-precondition', 'This form is not taking orders.');
  if ((pf.acceptFrom && now < pf.acceptFrom) || (pf.acceptUntil && now > pf.acceptUntil)) throw new HttpsError('failed-precondition', 'This form is not taking orders.');
  const parcel = parcelForForm(pf, lines);
  if ('error' in parcel) throw new HttpsError('invalid-argument', parcel.error);

  const settings = await getSettings();
  const origin = shippingOf(settings).originPostalCode;
  // Fees are the published ones, so the total matches what the page showed.
  const fees = feesFor(pf.settings, settings);
  const options = await lionRates(origin, postal, parcel.billedKg, now);

  const quote: ShippingQuote = {
    uid, formId, postalCode: postal, originPostalCode: origin, lines: parcel.lines,
    grams: parcel.grams, billedKg: parcel.billedKg, unweighed: parcel.unweighed, options,
    handlingFee: fees.handlingFee, packagingFee: fees.packagingFee, createdAt: now, expiresAt: now + QUOTE_TTL_MS,
  };
  const ref = await db().collection('shippingQuotes').add(clean(quote));
  return { quoteId: ref.id, postalCode: postal, grams: quote.grams, billedKg: quote.billedKg, unweighed: quote.unweighed, options, handlingFee: quote.handlingFee, packagingFee: quote.packagingFee, expiresAt: quote.expiresAt };
});

/**
 * The shipping to charge on an imported submission: its quote when it still fits, else a fresh
 * price from the server (flagged for staff when it differs from what the customer was shown),
 * else a flag only. Never throws.
 */
export async function shippingForSubmission(sub: Submission, settings: Settings, submittedAt: number): Promise<{ value?: OrderShipping; flag?: string } | undefined> {
  if (sub.fulfilment !== 'mail') return undefined;
  try {
    const quoteId = sub.shipping?.quoteId;
    const safeId = typeof quoteId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(quoteId) ? quoteId : '';
    const [pfSnap, qSnap] = await Promise.all([
      db().doc(`publicForms/${sub.formId}`).get(),
      safeId ? db().doc(`shippingQuotes/${safeId}`).get() : Promise.resolve(null),
    ]);
    const pf = pfSnap.exists ? (pfSnap.data() as PublicForm) : null;
    const quote = qSnap?.exists ? (qSnap.data() as ShippingQuote) : null;
    const r = resolveShipping({ sub, submittedAt, pf, quote });
    if (r.kind === 'none') return undefined;
    if (r.kind === 'flag') return { flag: r.flag };
    if (r.kind === 'ok') return { value: r.shipping, ...(r.unweighed.length ? { flag: unweighedFlag(r.unweighed) } : {}) };

    // The quote no longer fits: price it now, the way quoteShipping would.
    const origin = shippingOf(settings).originPostalCode;
    const options = await lionRates(origin, r.postalCode, r.billedKg);
    const option = options.find((o) => o.service === r.service);
    if (!option) return { flag: `Shipping was not charged: ${r.reason}, and Lion no longer offers that service to ${r.postalCode}. Agree the fee with the customer.` };
    const fees = feesFor(pf?.settings, settings);
    const value = orderShippingFrom(option, fees, r, r.postalCode, Date.now(), safeId || undefined, true);
    const shown = quote?.options.find((o) => o.service === r.service);
    const same = !!shown && shown.price === option.price && quote!.handlingFee === fees.handlingFee && quote!.packagingFee === fees.packagingFee;
    const notes = [same ? '' : `Shipping was priced again at import because ${r.reason}; the customer may have seen a different amount. Confirm the total with them.`, unweighedFlag(r.unweighed)].filter(Boolean);
    return { value, ...(notes.length ? { flag: notes.join(' ') } : {}) };
  } catch (e) {
    logger.error('[shipping] import pricing failed', sub.id, e);
    return { flag: 'Shipping could not be priced at import. Agree the shipping fee with the customer and add it to the order.' };
  }
}
