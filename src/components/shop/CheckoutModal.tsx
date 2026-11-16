'use client';

// The checkout as a dialog in up to four steps: pick up or mail (preorders only), your details,
// a read-only review, then payment with the receipt. Every typed value lives in the CheckoutState the
// page owns (and keeps in sessionStorage), so closing the dialog or reloading the page returns the
// customer to the same step. Only the receipt file is local: browsers cannot keep it across a reload.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { StoreCatalog } from '@/types';
import type { StoreChoice } from '@/lib/store';
import { confirmationCode } from '@/lib/forms';
import { formatMoney } from '@/lib/format';
import { shipRule, useShippingQuote, type ShippingDeps } from '@/lib/shippingQuote';
import { clampStep, detailsProblems, stepsFor, type CheckoutState, type StepChecks, type StepId } from '@/lib/checkoutState';
import { findAddress, forgetInBook, rememberInBook, type SavedAddress } from '@/lib/addressBook';
import { ShopShipping, Text, shippingProblem, type Line } from './parts';
import type { ShopDraft } from './Shop';

export interface CheckoutModalProps {
  catalog: StoreCatalog;
  choice: StoreChoice;
  okLines: Line[];
  badLines: Line[];
  total: number;
  deps?: ShippingDeps;
  preview?: boolean;
  state: CheckoutState;
  patch: (p: Partial<CheckoutState>) => void;
  /** The receipt file, owned by the page so closing and reopening the dialog keeps it (a reload cannot). */
  proof: File | null;
  setProof: (f: File | null) => void;
  onSubmit: (d: ShopDraft, proof: File | undefined, grandTotal: number, extras: [string, number][]) => Promise<void>;
}

const STEP_LABELS: Record<StepId, string> = { fulfilment: 'Pick up or mail', details: 'Your details', review: 'Review', payment: 'Payment' };

/** The progress line: one circle per step, filled up to the current one, no visible labels. Done steps are buttons that jump back. */
export function StepDots({ steps, current, onJump }: { steps: StepId[]; current: StepId; onJump: (s: StepId) => void }) {
  const cur = steps.indexOf(current);
  return (
    <ol className="shop-dots" aria-label="Checkout progress">
      {steps.map((s, i) => {
        const text = `${STEP_LABELS[s]}, step ${i + 1} of ${steps.length}`;
        return (
          <li key={s} className={i <= cur ? 'is-reached' : ''}>
            {i < cur
              ? <button type="button" className="shop-dot is-done" onClick={() => onJump(s)}><span className="sr-only">{text}</span></button>
              : <span className={`shop-dot ${i === cur ? 'is-current' : ''}`} aria-current={i === cur ? 'step' : undefined}><span className="sr-only">{text}</span></span>}
          </li>
        );
      })}
    </ol>
  );
}

export default function CheckoutModal({ catalog, choice, okLines, badLines, total, deps, state, patch, proof, setProof, onSubmit }: CheckoutModalProps) {
  const kind = choice.lane.kind;
  const isPre = kind === 'preorder';
  const steps = stepsFor(kind);
  const idx = steps.indexOf(state.step);
  const days = choice.lane.pickupDays;
  const shipped = state.fulfilment === 'mail';
  const live = !!deps;
  const currency = catalog.currency;

  // The quote hook lives here, not in the details step, so it survives moving between steps.
  const cartLines = useMemo(() => Object.fromEntries(okLines.map((l) => [l.key, l.qty])), [okLines]);
  const q = useShippingQuote({
    deps, form: choice.doc, lines: cartLines, active: shipped && okLines.length > 0,
    onSignedIn: (u) => patch({ name: state.name || u.name, email: state.email || u.email }),
  });
  const setPostal = (v: string) => { q.setPostal(v); patch({ postal: v.replace(/\D/g, '').slice(0, 5) }); };
  const optService = q.option?.service ?? '';
  useEffect(() => { if (optService && optService !== state.service) patch({ service: optService }); }, [optService]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saved addresses, loaded once per signed-in customer while the dialog is open. Null: none to offer.
  const book = deps?.addressBook;
  const uid = deps?.customer?.uid;
  const [saved, setSaved] = useState<SavedAddress[] | null>(null);
  useEffect(() => {
    if (!book || !uid) { setSaved(null); return; }
    let on = true;
    book.load(uid).then((l) => { if (on) setSaved(l); }).catch((e) => { console.error('[shop] addresses', e); if (on) setSaved([]); });
    return () => { on = false; };
  }, [book, uid]);
  const pickSaved = (a: SavedAddress | null) => { setPostal(a?.postalCode ?? ''); patch({ address: a?.address ?? '' }); };
  const forget = (a: SavedAddress) => {
    if (!book || !uid || !saved) return;
    setSaved(saved.filter((x) => x.id !== a.id));
    forgetInBook(book, uid, a.id).then((l) => { if (l) setSaved(l); }).catch((e) => console.error('[shop] forget address', e));
  };
  const chosenSaved = saved ? findAddress(saved, state.postal, state.address) : undefined;

  const checks: StepChecks = { needDay: state.fulfilment === 'pickup' && days.length > 0, shipped, shippingProblem: shipped ? shippingProblem(q, live) : '' };
  const [err, setErr] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const grandTotal = total + (shipped ? q.extra : 0);
  // A shipping problem that only shows once the quote is back is a banner on the later steps, never a silent jump.
  const shipIssue = shipped && q.state !== 'loading' ? shippingProblem(q, live) : '';
  // A shipping error flagged by Continue follows the live state: it clears itself once the customer
  // signs in or the quote is ready, instead of lingering as a stale sentence.
  const shipError = err.ship ? (shippingProblem(q, live) || undefined) : undefined;

  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    if (state.postal) q.setPostal(state.postal);
    if (state.service) q.setService(state.service);
    // Only the typed fields are checked here: the Google session and the quote come back later.
    const clamped = clampStep(state, kind, { ...checks, shippingProblem: '' });
    if (clamped !== state.step) patch({ step: clamped });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A field's error goes away as soon as the customer types in it; Continue re-checks everything.
  const clearErr = (k: string) => setErr((e) => { if (!(k in e)) return e; const n = { ...e }; delete n[k]; return n; });
  const set = <K extends keyof CheckoutState>(k: K, v: CheckoutState[K]) => { patch({ [k]: v } as Partial<CheckoutState>); clearErr(k); };
  const go = (s: StepId) => { setErr({}); patch({ step: s }); };
  const close = () => patch({ open: false });
  const next = () => {
    if (state.step === 'details') {
      const e = detailsProblems(state, checks);
      setErr(e);
      if (Object.keys(e).length > 0) return;
    }
    go(steps[idx + 1]);
  };

  const submit = async () => {
    const e = detailsProblems(state, checks);
    if (Object.keys(e).length > 0) { setErr(e); patch({ step: 'details' }); return; }
    if (okLines.length === 0) { setErr({ submit: 'Your cart is empty.' }); return; }
    if (badLines.length > 0) { setErr({ submit: 'Remove the unavailable items first.' }); return; }
    if (!proof) { setErr({ submit: 'Upload your transfer receipt to place the order.' }); return; }
    if (website) return; // honeypot
    const seen = Object.fromEntries(okLines.filter((l) => l.p!.price.entryId).map((l) => [l.key, l.p!.price.entryId!]));
    const draft: ShopDraft = {
      formId: choice.doc.formId, eventId: choice.doc.eventId, batchId: choice.doc.batchId, version: choice.doc.version, code: confirmationCode(),
      customer: { name: state.name.trim(), email: state.email.trim(), phone: state.phone.trim(), ...(shipped ? { address: state.address.trim() } : {}) },
      ...(shipped && q.result && q.option ? { postalCode: q.result.postalCode, shipping: { quoteId: q.result.quoteId, service: q.option.service }, customerUid: deps?.customer?.uid } : {}),
      fulfilment: state.fulfilment, ...(state.fulfilment === 'pickup' && state.day ? { pickupDay: state.day } : {}),
      notes: state.notes.trim(), lines: cartLines, submittedAt: Date.now(), status: 'new',
      orderType: kind, seen, ...(state.pay ? { paymentMethod: state.pay } : {}),
    };
    // Shipping lines for the thank-you page, in the order the review showed them.
    const extras: [string, number][] = shipped && q.option && q.result
      ? ([[`Shipping · ${q.option.name} · ${q.result.billedKg} kg`, q.option.price], ['Handling', q.result.handlingFee], ['Packaging', q.result.packagingFee]] as [string, number][]).filter(([, v]) => v > 0)
      : [];
    setSending(true);
    setErr({});
    try {
      await onSubmit(draft, proof, grandTotal, extras);
      // The order is placed; remembering the address is a courtesy, so a failure here only logs.
      // The book is read again right before the write, so a failed earlier read cannot wipe it.
      if (shipped && state.saveAddress && book && uid && draft.postalCode && draft.customer.address) {
        rememberInBook(book, uid, { postalCode: draft.postalCode, address: draft.customer.address }, Date.now(), confirmationCode)
          .catch((e) => console.error('[shop] save address', e));
      }
    }
    catch (x) { console.error(x); setErr({ submit: 'Could not send your order. Check your connection and try again.' }); }
    finally { setSending(false); }
  };

  const lineName = (l: Line) => <><b>{l.p!.product.name}</b>{l.p!.variant.name && <span className="shop-line-variant"> · {l.p!.variant.name}</span>}</>;

  const fulfilmentStep = (
    <fieldset>
      <legend>Pick up or ship</legend>
      <div className="shop-radios">
        <label className={`shop-option ${state.fulfilment === 'pickup' ? 'is-on' : ''}`}><input type="radio" name="ful" checked={state.fulfilment === 'pickup'} onChange={() => patch({ fulfilment: 'pickup' })} /><b>Pick up at the booth</b><span>At {choice.lane.eventName}</span></label>
        <label className={`shop-option ${state.fulfilment === 'mail' ? 'is-on' : ''}`}><input type="radio" name="ful" checked={state.fulfilment === 'mail'} onChange={() => patch({ fulfilment: 'mail' })} /><b>Ship after the event</b><span>Pay shipping now; it is sent after the event ends</span></label>
      </div>
    </fieldset>
  );

  const detailsStep = (
    <>
      <fieldset>
        <legend>Your details</legend>
        <Text id="shop-name" label="Name" value={state.name} onChange={(v) => set('name', v)} error={err.name} autoComplete="name" />
        <Text id="shop-email" label="E-mail" type="email" value={state.email} onChange={(v) => set('email', v)} error={err.email} autoComplete="email" />
        <Text id="shop-phone" label="Phone (WhatsApp preferred)" type="tel" value={state.phone} onChange={(v) => set('phone', v)} error={err.phone} autoComplete="tel" />
        {checks.needDay && (
          <div className="shop-field">
            <label htmlFor="shop-day">Pick-up day</label>
            <select id="shop-day" value={state.day} onChange={(e) => set('day', e.target.value)} aria-invalid={!!err.day}>
              <option value="">Choose a day</option>
              {days.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {err.day && <span className="shop-error">{err.day}</span>}
          </div>
        )}
      </fieldset>
      {shipped && (
        <fieldset>
          <legend>Shipping</legend>
          {live && deps?.customer && (
            <p className="shop-signedin">Signed in as <b>{deps.customer.name || deps.customer.email}</b>{deps.customer.name && <span> · {deps.customer.email}</span>}</p>
          )}
          {live && q.state !== 'signin' && uid && saved && saved.length > 0 && (
            <fieldset className="shop-saved">
              <legend>Saved addresses</legend>
              <div className="shop-radios shop-saved-list" role="radiogroup" aria-label="Saved addresses">
                {saved.map((a) => (
                  <label key={a.id} className={`shop-option ${chosenSaved?.id === a.id ? 'is-on' : ''}`}>
                    <input type="radio" name="saved" checked={chosenSaved?.id === a.id} onChange={() => pickSaved(a)} />
                    <b>{a.postalCode}</b>
                    <span>{a.address}</span>
                    <button type="button" className="shop-link shop-saved-forget" onClick={(e) => { e.preventDefault(); e.stopPropagation(); forget(a); }}>Forget</button>
                  </label>
                ))}
                <label className={`shop-option ${!chosenSaved ? 'is-on' : ''}`}>
                  <input type="radio" name="saved" checked={!chosenSaved} onChange={() => pickSaved(null)} />
                  <b>New address</b>
                </label>
              </div>
            </fieldset>
          )}
          <ShopShipping q={q} live={live} currency={currency} error={shipError} onPostal={setPostal} />
          {(q.state !== 'signin' || !live) && (
            <div className="shop-field">
              <label htmlFor="shop-address">Shipping address</label>
              <textarea id="shop-address" rows={3} value={state.address} onChange={(e) => set('address', e.target.value)} aria-invalid={!!err.address} placeholder="Street and number, RT/RW, kelurahan, kecamatan, city" autoComplete="street-address" />
              {err.address && <span className="shop-error">{err.address}</span>}
              {book && uid && (
                <label className="shop-check shop-save-address">
                  <input type="checkbox" checked={state.saveAddress} onChange={(e) => patch({ saveAddress: e.target.checked })} />
                  Save this address
                  <span className="shop-tip" tabIndex={0} role="note" aria-label="Saved addresses are offered again at your next order, signed in with the same Google account. You can forget one any time." data-tip="Saved addresses are offered again at your next order, signed in with the same Google account. You can forget one any time.">?</span>
                </label>
              )}
            </div>
          )}
          <p className="shop-hint">{shipRule(kind)}</p>
          {!isPre && <p className="shop-hint">Mail orders ship after current events end. Some items may still be in production; we will tell you if yours is.</p>}
        </fieldset>
      )}
      <div className="shop-field">
        <label htmlFor="shop-notes">Notes (optional)</label>
        <textarea id="shop-notes" rows={2} value={state.notes} onChange={(e) => patch({ notes: e.target.value })} />
      </div>
      <div className="shop-honeypot" aria-hidden="true"><label>Website <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>
    </>
  );

  const reviewStep = (
    <section className="shop-review" aria-label="Review your order">
      <ul className="shop-lines">
        {okLines.map((l) => <li key={l.key}><div>{lineName(l)}</div><span>{l.qty} ×</span><span className="shop-money shop-line-total">{formatMoney(l.qty * l.p!.price.unitPrice, currency)}</span></li>)}
      </ul>
      <div className="shop-breakdown">
        <div><span>Items</span><span className="shop-money">{formatMoney(total, currency)}</span></div>
        {shipped && q.option && q.result && (
          <>
            <div><span>Shipping · {q.option.name} · {q.result.billedKg} kg</span><span className="shop-money">{formatMoney(q.option.price, currency)}</span></div>
            {q.result.handlingFee > 0 && <div><span>Handling</span><span className="shop-money">{formatMoney(q.result.handlingFee, currency)}</span></div>}
            {q.result.packagingFee > 0 && <div><span>Packaging</span><span className="shop-money">{formatMoney(q.result.packagingFee, currency)}</span></div>}
          </>
        )}
        {shipped && q.state === 'loading' && <div><span>Shipping is being priced again…</span><span /></div>}
      </div>
      <div className="shop-total"><span>Total</span><span className="shop-money">{formatMoney(grandTotal, currency)}</span></div>
      <div className="shop-review-block">
        <div className="shop-review-head"><h3>How you get it</h3><button type="button" className="shop-link" onClick={() => go(isPre ? 'fulfilment' : 'details')}>Edit</button></div>
        {shipped
          ? <p>Shipped to:<br />{state.address.trim() || '—'}<br />Postcode {state.postal || '—'}{q.option ? ` · ${q.option.name}` : ''}</p>
          : <p>Pick up at the booth · {choice.lane.eventName}{state.day ? ` · ${state.day}` : ''}</p>}
      </div>
      <div className="shop-review-block">
        <div className="shop-review-head"><h3>Your details</h3><button type="button" className="shop-link" onClick={() => go('details')}>Edit</button></div>
        <p>{state.name.trim()}<br />{state.email.trim()}<br />{state.phone.trim()}{state.notes.trim() && <><br /><span className="shop-hint">Note: {state.notes.trim()}</span></>}</p>
      </div>
    </section>
  );

  const paymentStep = (
    <fieldset>
      <legend>Payment</legend>
      <div className="shop-radios">
        {catalog.paymentChoices.map((p) => (
          <label key={p} className={`shop-option ${state.pay === p ? 'is-on' : ''}`}><input type="radio" name="pay" checked={state.pay === p} onChange={() => patch({ pay: p })} /><b>{p}</b></label>
        ))}
        <label className="shop-option is-disabled"><input type="radio" name="pay" disabled /><b>Online payment</b><span>Coming soon</span></label>
      </div>
      {catalog.paymentText && <p className="shop-paytext">{catalog.paymentText}</p>}
      <div className="shop-receipt">
        <div className="shop-receipt-head">
          <b>Receipt</b>
          <span className="shop-hint">JPG, PNG or PDF, up to 10 MB.</span>
        </div>
        <div className="shop-receipt-row">
          <label className="shop-btn shop-file-btn">
            {proof ? 'Change file' : 'Choose file'}
            <input id="shop-proof" type="file" accept="image/*,application/pdf" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
          </label>
          {proof
            ? <span className="shop-receipt-name">{proof.name}<button type="button" className="shop-link" onClick={() => setProof(null)}>Remove</button></span>
            : <span className="shop-hint">Upload your transfer receipt to place the order.</span>}
        </div>
      </div>
      <div className="shop-total"><span>Total</span><span className="shop-money">{formatMoney(grandTotal, currency)}</span></div>
    </fieldset>
  );

  const later = state.step === 'review' || state.step === 'payment';
  const placeDisabled = !proof || sending || okLines.length === 0 || badLines.length > 0 || !!shipIssue || (shipped && q.state === 'loading');

  return (
    <dialog ref={dialog} className="shop-modal" aria-label="Checkout" onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <form className="shop-modal-body shop-form" noValidate onSubmit={(e) => { e.preventDefault(); if (state.step === 'payment') void submit(); else next(); }}>
        <StepDots steps={steps} current={state.step} onJump={go} />
        <div className="shop-checkout-head">
          <h2>Your {isPre ? 'preorder' : 'mail order'}</h2>
          <button type="button" className="shop-btn" onClick={close}>Close</button>
        </div>
        {state.step === 'fulfilment' && fulfilmentStep}
        {state.step === 'details' && detailsStep}
        {state.step === 'review' && reviewStep}
        {state.step === 'payment' && paymentStep}
        {later && shipIssue && <p className="shop-error">{shipIssue} <button type="button" className="shop-link" onClick={() => go('details')}>Back to your details</button></p>}
        {err.submit && <p className="shop-error">{err.submit}</p>}
        <div className="shop-modal-nav">
          {idx > 0 ? <button type="button" className="shop-btn" onClick={() => go(steps[idx - 1])}>Back</button> : <span />}
          {state.step === 'payment'
            ? <button type="submit" className="shop-btn shop-btn-primary" disabled={placeDisabled}>{sending ? 'Sending…' : `Place ${isPre ? 'preorder' : 'mail order'} · ${formatMoney(grandTotal, currency)}`}</button>
            : <button type="submit" className="shop-btn shop-btn-primary" disabled={state.step === 'review' && !!shipIssue}>Continue</button>}
        </div>
      </form>
    </dialog>
  );
}
