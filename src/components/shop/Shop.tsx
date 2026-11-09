'use client';

// The customer storefront. Pure UI: data comes in as props and orders leave through onSubmit,
// so /shop/ (Firestore) and the localhost sandbox (sample data) render the same component.
// Typography keeps three levels apart: item titles bold, variants quiet chips, prices monospace.
// No icons anywhere; every control says what it does in words.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OrderType, PublicForm, PublicPrices, StoreCatalog, StoreProduct, StoreStatus, StoreVariant, Submission } from '@/types';
import { storePrice, storeState, type StoreChoice, type StorePrice } from '@/lib/store';
import { confirmationCode } from '@/lib/forms';
import { formatMoney, titleCase } from '@/lib/format';
import './shop.css';

export type ShopDraft = Omit<Submission, 'id'>;
/** A message from the contact form; it lands in the staff's shared inbox. */
export type ContactDraft = { name: string; email: string; subject: string; message: string; orderRef?: string };

export interface ShopProps {
  catalog: StoreCatalog;
  status: StoreStatus | null;
  docs: Record<string, PublicForm | null | undefined>;
  prices: PublicPrices | null;
  onSubmit: (choice: StoreChoice, draft: ShopDraft, proof?: File) => Promise<void>;
  /** The contact form; without it the shop shows no "Contact us". */
  onContact?: (c: ContactDraft) => Promise<void>;
  /** Fixed clock for the sandbox; real time otherwise. */
  now?: number;
  /** Shown above the page, e.g. the sandbox notice. */
  notice?: React.ReactNode;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CART_KEY = 'tsu.shop.cart';
const LANE_KEY = 'tsu.shop.lane';
const read = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

interface Priced { variant: StoreVariant; product: StoreProduct; price: StorePrice; orderable: boolean }

export default function Shop({ catalog, status, docs, prices, onSubmit, onContact, now, notice }: ShopProps) {
  const [clock, setClock] = useState(() => now ?? Date.now());
  useEffect(() => { if (now !== undefined) { setClock(now); return; } const t = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(t); }, [now]);
  const state = useMemo(() => storeState(catalog, status, docs, clock), [catalog, status, docs, clock]);

  // Which order type the customer picked; only a real choice when staff opened more than one.
  const [laneId, setLaneId] = useState('');
  useEffect(() => { setLaneId(read(LANE_KEY)); }, []);
  const choice = state.choices.find((c) => c.lane.id === laneId) ?? (state.choices.length === 1 ? state.choices[0] : undefined);
  const pickLane = (id: string) => { setLaneId(id); write(LANE_KEY, id); };

  const [cart, setCart] = useState<Record<string, number>>({});
  useEffect(() => { try { const c = JSON.parse(read(CART_KEY) || '{}'); if (c && typeof c === 'object') setCart(c); } catch { /* ignore */ } }, []);
  const saveCart = (next: Record<string, number>) => { setCart(next); write(CART_KEY, JSON.stringify(next)); };
  const maxQty = Math.max(1, choice?.doc.maxQtyPerLine ?? 20);
  const setQty = (key: string, q: number) => {
    const next = { ...cart };
    const v = Math.max(0, Math.min(maxQty, Math.round(q)));
    if (v === 0) delete next[key]; else next[key] = v;
    saveCart(next);
  };

  // Price every variant for the chosen order type; outside an order, show the regular mail-order price.
  const priced = useMemo(() => {
    const kind: OrderType = choice?.lane.kind ?? 'mail_order';
    const m = new Map<string, Priced>();
    for (const product of catalog.products) {
      for (const variant of product.variants) {
        const orderable = !!choice && variant.key in choice.doc.items;
        const price = storePrice(variant.key, variant.fallback, orderable ? kind : 'mail_order', prices, orderable ? choice?.doc.overrides?.[variant.key] : undefined);
        m.set(variant.key, { variant, product, price, orderable });
      }
    }
    return m;
  }, [catalog.products, choice, prices]);

  // Search and filters.
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [artists, setArtists] = useState<Set<string>>(new Set());
  const [onlyOrderable, setOnlyOrderable] = useState(false);
  const facets = useMemo(() => {
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
    return { types: uniq(catalog.products.map((p) => p.type)), cats: uniq(catalog.products.map((p) => p.category)), artists: uniq(catalog.products.map((p) => p.artist)) };
  }, [catalog.products]);
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); setter(n); };
  const filtersOn = types.size + cats.size + artists.size > 0 || !!q || onlyOrderable;
  const visible = catalog.products.filter((p) => {
    if (types.size && !types.has(p.type)) return false;
    if (cats.size && !(p.category && cats.has(p.category))) return false;
    if (artists.size && !(p.artist && artists.has(p.artist))) return false;
    if (onlyOrderable && !p.variants.some((v) => priced.get(v.key)?.orderable)) return false;
    if (q) {
      const s = q.toLowerCase();
      const hay = [p.name, p.type, p.category, p.artist, ...p.variants.map((v) => v.name)].join(' ').toLowerCase();
      if (!s.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  // Until staff-chosen sections exist, one grid: type order (bundles last), then name.
  const isB = (t: string) => (t === 'bundle' ? 1 : 0);
  const sorted = [...visible].sort((a, b) => isB(a.type) - isB(b.type) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  const lines = Object.entries(cart).map(([key, qty]) => ({ key, qty, p: priced.get(key) })).filter((l) => l.p);
  const okLines = lines.filter((l) => l.p!.orderable);
  const badLines = lines.filter((l) => !l.p!.orderable);
  const count = okLines.reduce((s, l) => s + l.qty, 0);
  const total = okLines.reduce((s, l) => s + l.qty * l.p!.price.unitPrice, 0);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ code: string; lines: typeof okLines; total: number; label: string } | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <div className="shop">
      {notice}
      <header className="shop-head">
        <h1 className="shop-title">{catalog.title || 'Shop'}</h1>
        {catalog.intro && <p className="shop-intro">{catalog.intro}</p>}
        {onContact && !contactOpen && <p className="shop-intro"><button type="button" className="shop-link" onClick={() => setContactOpen(true)}>Contact us</button> with a question about an item or your order.</p>}
      </header>

      {onContact && contactOpen && <ContactForm onSend={onContact} onClose={() => setContactOpen(false)} />}

      {done ? (
        <ThankYou done={done} currency={catalog.currency} onBack={() => setDone(null)} />
      ) : (
        <>
          <OrderTypeBanner state={state} choice={choice} onPick={pickLane} />

          <section className="shop-tools" aria-label="Search and filters">
            <label className="shop-search">
              <span className="sr-only">Search the catalogue</span>
              <input type="search" placeholder="Search by name, type, artist" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            {facets.types.length > 1 && <ChipGroup label="Type" values={facets.types} on={types} onToggle={(v) => toggle(types, setTypes, v)} format={titleCase} />}
            {facets.cats.length > 0 && <ChipGroup label="Series" values={facets.cats} on={cats} onToggle={(v) => toggle(cats, setCats, v)} />}
            {facets.artists.length > 0 && <ChipGroup label="Artist" values={facets.artists} on={artists} onToggle={(v) => toggle(artists, setArtists, v)} />}
            <div className="shop-tools-row">
              {choice && (
                <label className="shop-check"><input type="checkbox" checked={onlyOrderable} onChange={(e) => setOnlyOrderable(e.target.checked)} /> Only items in this {choice.lane.kind === 'preorder' ? 'preorder' : 'order'}</label>
              )}
              <span className="shop-count">{visible.length} of {catalog.products.length} items</span>
              {filtersOn && <button type="button" className="shop-link" onClick={() => { setQ(''); setTypes(new Set()); setCats(new Set()); setArtists(new Set()); setOnlyOrderable(false); }}>Clear filters</button>}
            </div>
          </section>

          {visible.length === 0 ? <p className="shop-empty">Nothing matches. Try fewer filters.</p> : (
            <section className="shop-section" aria-label="Catalogue">
              <div className="shop-grid">
                {sorted.map((p) => <ProductCard key={p.itemId} product={p} priced={priced} cart={cart} setQty={setQty} choice={choice} currency={catalog.currency} max={maxQty} />)}
              </div>
            </section>
          )}

          {choice && lines.length > 0 && !open && (
            <div className="shop-cartbar" role="region" aria-label="Cart">
              <span><b>Cart</b> · {count} {count === 1 ? 'item' : 'items'} · <span className="shop-money">{formatMoney(total, catalog.currency)}</span>{badLines.length > 0 && <span className="shop-warn"> · {badLines.length} unavailable</span>}</span>
              <button type="button" className="shop-btn shop-btn-primary" onClick={() => setOpen(true)}>Review and check out</button>
            </div>
          )}
          {choice && open && (
            <Checkout
              catalog={catalog} choice={choice} okLines={okLines} badLines={badLines} total={total} max={maxQty}
              setQty={setQty} removeBad={() => { const n = { ...cart }; for (const l of badLines) delete n[l.key]; saveCart(n); }}
              onClose={() => setOpen(false)}
              onSubmit={async (draft, proof) => {
                await onSubmit(choice, draft, proof);
                setDone({ code: draft.code, lines: okLines, total, label: choice.label });
                saveCart({});
                setOpen(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function OrderTypeBanner({ state, choice, onPick }: { state: ReturnType<typeof storeState>; choice?: StoreChoice; onPick: (id: string) => void }) {
  if (state.choices.length === 0) {
    return (
      <div className="shop-banner shop-banner-quiet">
        <b>Not taking orders right now</b>
        <span>Browse the catalogue. Follow our socials for the next preorder.</span>
      </div>
    );
  }
  if (state.choices.length === 1) {
    const c = state.choices[0];
    return (
      <div className={`shop-banner ${c.lane.kind === 'preorder' ? 'shop-banner-po' : 'shop-banner-mo'}`}>
        <b>{c.label}</b>
        <span>{c.detail}</span>
      </div>
    );
  }
  return (
    <fieldset className="shop-choice">
      <legend>How do you want to order?</legend>
      <div className="shop-choice-row">
        {state.choices.map((c) => (
          <label key={c.lane.id} className={`shop-option ${choice?.lane.id === c.lane.id ? 'is-on' : ''}`}>
            <input type="radio" name="lane" checked={choice?.lane.id === c.lane.id} onChange={() => onPick(c.lane.id)} />
            <b>{c.label}</b>
            <span>{c.detail}</span>
          </label>
        ))}
      </div>
      {!choice && <p className="shop-hint">Pick one to see prices and add items.</p>}
    </fieldset>
  );
}

function ChipGroup({ label, values, on, onToggle, format = (s: string) => s }: { label: string; values: string[]; on: Set<string>; onToggle: (v: string) => void; format?: (s: string) => string }) {
  return (
    <div className="shop-chips" role="group" aria-label={label}>
      <span className="shop-chips-label">{label}</span>
      {values.map((v) => (
        <button key={v} type="button" className={`shop-chip ${on.has(v) ? 'is-on' : ''}`} aria-pressed={on.has(v)} onClick={() => onToggle(v)}>{format(v)}</button>
      ))}
    </div>
  );
}

function PriceLine({ price, currency, kind }: { price: StorePrice; currency: string; kind?: OrderType }) {
  const save = price.refPrice ? price.refPrice - price.unitPrice : 0;
  return (
    <div className="shop-price-block">
      <div className="shop-price-row">
        <span className="shop-price">{formatMoney(price.unitPrice, currency)}</span>
        {price.refPrice && price.refPrice > price.unitPrice && (
          <span className="shop-ref"><span className="shop-ref-label">{price.refLabel}</span> <s>{formatMoney(price.refPrice, currency)}</s></span>
        )}
      </div>
      {save > 0 && (
        <div className="shop-save">
          {price.discountPercent ? `${price.discountPercent}% off · ` : ''}Save {formatMoney(save, currency)}{!price.discountPercent && kind === 'preorder' ? ' by preordering' : ''}
        </div>
      )}
    </div>
  );
}

function ProductCard({ product: p, priced, cart, setQty, choice, currency, max }: {
  product: StoreProduct; priced: Map<string, Priced>; cart: Record<string, number>; setQty: (k: string, q: number) => void; choice?: StoreChoice; currency: string; max: number;
}) {
  const named = p.variants.length > 1 || !!p.variants[0]?.name;
  const firstOrderable = p.variants.find((v) => priced.get(v.key)?.orderable) ?? p.variants[0];
  const [sel, setSel] = useState(firstOrderable.key);
  const cur = priced.get(sel) ?? priced.get(p.variants[0].key)!;
  const thumb = cur.variant.thumb || p.thumb;
  const inCart = cart[sel] ?? 0;
  const anyOrderable = p.variants.some((v) => priced.get(v.key)?.orderable);
  return (
    <article className="shop-card">
      {thumb ? <img className="shop-thumb" src={thumb} alt="" loading="lazy" /> : <div className="shop-thumb shop-thumb-empty" aria-hidden="true" />}
      <div className="shop-card-body">
        <h3 className="shop-item-title">{p.name}</h3>
        <div className="shop-meta">{[p.type === 'bundle' ? 'Bundle' : titleCase(p.type), p.category, p.artist].filter(Boolean).join(' · ')}</div>
        {named && (
          <div className="shop-variants" role="group" aria-label={`${p.name} options`}>
            {p.variants.map((v) => (
              <button key={v.key} type="button" className={`shop-variant ${sel === v.key ? 'is-on' : ''} ${priced.get(v.key)?.orderable ? '' : 'is-out'}`} aria-pressed={sel === v.key} onClick={() => setSel(v.key)}>
                {v.name || 'Standard'}{cart[v.key] ? ` (${cart[v.key]})` : ''}
              </button>
            ))}
          </div>
        )}
        <PriceLine price={cur.price} currency={currency} kind={cur.orderable ? choice?.lane.kind : undefined} />
        {!cur.orderable && (
          <div className="shop-note">
            {!choice ? 'Not available to order right now' : choice.lane.kind === 'preorder'
              ? (anyOrderable ? 'This option is not in this preorder' : `Not in the ${choice.lane.eventCode} preorder`)
              : 'Not available by mail order'}
          </div>
        )}
        <div className="shop-actions">
          {!cur.orderable ? (
            <button type="button" className="shop-btn" disabled>{choice ? 'Not available' : 'Not taking orders'}</button>
          ) : inCart === 0 ? (
            <button type="button" className="shop-btn shop-btn-primary" onClick={() => setQty(sel, 1)}>Add to cart</button>
          ) : (
            <Stepper value={inCart} max={max} onChange={(v) => setQty(sel, v)} label={`${p.name} ${cur.variant.name}`} />
          )}
        </div>
      </div>
    </article>
  );
}

function Stepper({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="shop-stepper" role="group" aria-label={`Quantity of ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} aria-label="One less">−</button>
      <span className="shop-money" aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="One more">+</button>
    </div>
  );
}

interface Line { key: string; qty: number; p?: Priced }

function Checkout({ catalog, choice, okLines, badLines, total, max, setQty, removeBad, onClose, onSubmit }: {
  catalog: StoreCatalog; choice: StoreChoice; okLines: Line[]; badLines: Line[]; total: number; max: number;
  setQty: (k: string, q: number) => void; removeBad: () => void; onClose: () => void; onSubmit: (d: ShopDraft, proof?: File) => Promise<void>;
}) {
  const isPre = choice.lane.kind === 'preorder';
  const days = choice.lane.pickupDays;
  const [c, setC] = useState({ name: '', email: '', phone: '', address: '', notes: '', website: '' });
  const [ful, setFul] = useState<'pickup' | 'mail'>(isPre ? 'pickup' : 'mail');
  const [day, setDay] = useState('');
  const [pay, setPay] = useState(catalog.paymentChoices[0] ?? '');
  const [proof, setProof] = useState<File | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const fulfilment = isPre ? ful : 'mail';
  const top = useRef<HTMLElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!c.name.trim()) e.name = 'Required';
    if (!c.email.trim()) e.email = 'Required'; else if (!EMAIL_RE.test(c.email.trim())) e.email = 'That e-mail address does not look right.';
    if (!c.phone.trim()) e.phone = 'Required';
    if (fulfilment === 'pickup' && days.length > 0 && !day) e.day = 'Choose a day';
    if (fulfilment === 'mail' && !c.address.trim()) e.address = 'Required for shipping';
    if (okLines.length === 0) e.lines = 'Your cart is empty.';
    if (badLines.length > 0) e.lines = 'Remove the unavailable items first.';
    setErr(e);
    if (Object.keys(e).length > 0) return;
    if (c.website) return; // honeypot
    const seen = Object.fromEntries(okLines.filter((l) => l.p!.price.entryId).map((l) => [l.key, l.p!.price.entryId!]));
    const draft: ShopDraft = {
      formId: choice.doc.formId, eventId: choice.doc.eventId, batchId: choice.doc.batchId, version: choice.doc.version, code: confirmationCode(),
      customer: { name: c.name.trim(), email: c.email.trim(), phone: c.phone.trim(), ...(fulfilment === 'mail' ? { address: c.address.trim() } : {}) },
      fulfilment, ...(fulfilment === 'pickup' && day ? { pickupDay: day } : {}),
      notes: c.notes.trim(), lines: Object.fromEntries(okLines.map((l) => [l.key, l.qty])), submittedAt: Date.now(), status: 'new',
      orderType: choice.lane.kind, seen, ...(pay ? { paymentMethod: pay } : {}),
    };
    setSending(true);
    try { await onSubmit(draft, proof ?? undefined); }
    catch (x) { console.error(x); setErr({ submit: 'Could not send your order. Check your connection and try again.' }); }
    finally { setSending(false); }
  };

  return (
    <section ref={top} className="shop-checkout" aria-label="Checkout">
      <div className="shop-checkout-head">
        <h2>Your {isPre ? 'preorder' : 'mail order'}</h2>
        <button type="button" className="shop-btn" onClick={onClose}>Keep shopping</button>
      </div>
      <p className="shop-hint">{choice.label}. {choice.detail}</p>

      <ul className="shop-lines">
        {okLines.map((l) => (
          <li key={l.key}>
            <div><b>{l.p!.product.name}</b>{l.p!.variant.name && <span className="shop-line-variant"> · {l.p!.variant.name}</span>}<div className="shop-hint shop-money">{formatMoney(l.p!.price.unitPrice, catalog.currency)} each</div></div>
            <Stepper value={l.qty} max={max} onChange={(v) => setQty(l.key, v)} label={l.p!.product.name} />
            <span className="shop-money shop-line-total">{formatMoney(l.qty * l.p!.price.unitPrice, catalog.currency)}</span>
          </li>
        ))}
        {badLines.map((l) => (
          <li key={l.key} className="is-out">
            <div><b>{l.p!.product.name}</b>{l.p!.variant.name && <span className="shop-line-variant"> · {l.p!.variant.name}</span>}<div className="shop-warn">Not available for this order</div></div>
            <button type="button" className="shop-link" onClick={() => setQty(l.key, 0)}>Remove</button>
          </li>
        ))}
      </ul>
      {badLines.length > 0 && <button type="button" className="shop-btn" onClick={removeBad}>Remove unavailable items</button>}
      <div className="shop-total"><span>Total</span><span className="shop-money">{formatMoney(total, catalog.currency)}</span></div>
      {err.lines && <p className="shop-error">{err.lines}</p>}

      <form onSubmit={submit} noValidate className="shop-form">
        <fieldset>
          <legend>Your details</legend>
          <Text id="shop-name" label="Name" value={c.name} onChange={(v) => setC({ ...c, name: v })} error={err.name} autoComplete="name" />
          <Text id="shop-email" label="E-mail" type="email" value={c.email} onChange={(v) => setC({ ...c, email: v })} error={err.email} autoComplete="email" />
          <Text id="shop-phone" label="Phone (WhatsApp preferred)" type="tel" value={c.phone} onChange={(v) => setC({ ...c, phone: v })} error={err.phone} autoComplete="tel" />
        </fieldset>

        <fieldset>
          <legend>{isPre ? 'Pick up or ship' : 'Shipping'}</legend>
          {isPre && (
            <div className="shop-radios">
              <label className={`shop-option ${ful === 'pickup' ? 'is-on' : ''}`}><input type="radio" name="ful" checked={ful === 'pickup'} onChange={() => setFul('pickup')} /><b>Pick up at the booth</b><span>At {choice.lane.eventName}</span></label>
              <label className={`shop-option ${ful === 'mail' ? 'is-on' : ''}`}><input type="radio" name="ful" checked={ful === 'mail'} onChange={() => setFul('mail')} /><b>Ship after the event</b><span>Shipping is arranged after the event ends</span></label>
            </div>
          )}
          {fulfilment === 'pickup' && days.length > 0 && (
            <div className="shop-field">
              <label htmlFor="shop-day">Pick-up day</label>
              <select id="shop-day" value={day} onChange={(e) => setDay(e.target.value)} aria-invalid={!!err.day}>
                <option value="">Choose a day</option>
                {days.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              {err.day && <span className="shop-error">{err.day}</span>}
            </div>
          )}
          {fulfilment === 'mail' && (
            <div className="shop-field">
              <label htmlFor="shop-address">Shipping address</label>
              <textarea id="shop-address" rows={3} value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} aria-invalid={!!err.address} placeholder="Street, subdistrict, city, province, postal code" />
              {err.address && <span className="shop-error">{err.address}</span>}
            </div>
          )}
          {!isPre && <p className="shop-hint">Mail orders ship after current events end. Some items may still be in production; we will tell you if yours is.</p>}
        </fieldset>

        <fieldset>
          <legend>Payment</legend>
          <div className="shop-radios">
            {catalog.paymentChoices.map((p) => (
              <label key={p} className={`shop-option ${pay === p ? 'is-on' : ''}`}><input type="radio" name="pay" checked={pay === p} onChange={() => setPay(p)} /><b>{p}</b></label>
            ))}
            <label className="shop-option is-disabled"><input type="radio" name="pay" disabled /><b>Online payment</b><span>Coming soon</span></label>
          </div>
          {catalog.paymentText && <p className="shop-paytext">{catalog.paymentText}</p>}
          <div className="shop-field">
            <label htmlFor="shop-proof">Receipt (optional)</label>
            <input id="shop-proof" type="file" accept="image/*,application/pdf" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
            <span className="shop-hint">{isPre ? 'Preorders must be paid before the event.' : 'We ship after the payment is confirmed.'} JPG, PNG or PDF, up to 10 MB.</span>
          </div>
        </fieldset>

        <div className="shop-field">
          <label htmlFor="shop-notes">Notes (optional)</label>
          <textarea id="shop-notes" rows={2} value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} />
        </div>
        <div className="shop-honeypot" aria-hidden="true"><label>Website <input tabIndex={-1} autoComplete="off" value={c.website} onChange={(e) => setC({ ...c, website: e.target.value })} /></label></div>
        {err.submit && <p className="shop-error">{err.submit}</p>}
        <button type="submit" className="shop-btn shop-btn-primary shop-btn-wide" disabled={sending || okLines.length === 0}>
          {sending ? 'Sending…' : `Place ${isPre ? 'preorder' : 'mail order'} · ${formatMoney(total, catalog.currency)}`}
        </button>
      </form>
    </section>
  );
}

const CONTACT_MAX = { name: 120, email: 160, subject: 200, message: 5000, orderRef: 40 };

function ContactForm({ onSend, onClose }: { onSend: (c: ContactDraft) => Promise<void>; onClose: () => void }) {
  const [c, setC] = useState({ name: '', email: '', subject: '', message: '', orderRef: '', website: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const top = useRef<HTMLElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!c.name.trim()) e.name = 'Required';
    if (!c.email.trim()) e.email = 'Required'; else if (!EMAIL_RE.test(c.email.trim())) e.email = 'That e-mail address does not look right.';
    if (!c.message.trim()) e.message = 'Required';
    setErr(e);
    if (Object.keys(e).length > 0) return;
    if (c.website) { setSent(true); return; } // honeypot: pretend it went
    setSending(true);
    try {
      await onSend({
        name: c.name.trim().slice(0, CONTACT_MAX.name), email: c.email.trim().slice(0, CONTACT_MAX.email),
        subject: c.subject.trim().slice(0, CONTACT_MAX.subject) || 'Question from the shop', message: c.message.trim().slice(0, CONTACT_MAX.message),
        ...(c.orderRef.trim() ? { orderRef: c.orderRef.trim().slice(0, CONTACT_MAX.orderRef) } : {}),
      });
      setSent(true);
    } catch (x) {
      console.error(x);
      setErr({ submit: 'Could not send your message. Check your connection and try again.' });
    } finally { setSending(false); }
  };

  if (sent) {
    return (
      <section ref={top} className="shop-thanks" aria-label="Message sent">
        <h2>Message sent</h2>
        <p>Thank you. We answer by e-mail to {c.email.trim() || 'the address you gave'}, usually within a day or two.</p>
        <button type="button" className="shop-btn" onClick={onClose}>Back to the shop</button>
      </section>
    );
  }
  return (
    <section ref={top} className="shop-checkout" aria-label="Contact us">
      <div className="shop-checkout-head">
        <h2>Contact us</h2>
        <button type="button" className="shop-btn" onClick={onClose}>Close</button>
      </div>
      <p className="shop-hint">Questions about an item, a preorder or your order. We reply by e-mail.</p>
      <form className="shop-form" onSubmit={submit} noValidate>
        <Text id="ct-name" label="Name" value={c.name} onChange={(v) => setC({ ...c, name: v })} error={err.name} autoComplete="name" />
        <Text id="ct-email" label="E-mail" type="email" value={c.email} onChange={(v) => setC({ ...c, email: v })} error={err.email} autoComplete="email" />
        <Text id="ct-subject" label="Subject (optional)" value={c.subject} onChange={(v) => setC({ ...c, subject: v })} />
        <Text id="ct-order" label="Order number or confirmation code (optional)" value={c.orderRef} onChange={(v) => setC({ ...c, orderRef: v })} />
        <div className="shop-field">
          <label htmlFor="ct-message">Message</label>
          <textarea id="ct-message" rows={6} maxLength={CONTACT_MAX.message} value={c.message} onChange={(e) => setC({ ...c, message: e.target.value })} aria-invalid={!!err.message} />
          {err.message && <span className="shop-error">{err.message}</span>}
        </div>
        <div className="shop-honeypot" aria-hidden="true"><label>Website <input tabIndex={-1} autoComplete="off" value={c.website} onChange={(e) => setC({ ...c, website: e.target.value })} /></label></div>
        {err.submit && <p className="shop-error">{err.submit}</p>}
        <button type="submit" className="shop-btn shop-btn-primary shop-btn-wide" disabled={sending}>{sending ? 'Sending…' : 'Send message'}</button>
      </form>
    </section>
  );
}

function Text({ id, label, value, onChange, error, type = 'text', autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; type?: string; autoComplete?: string }) {
  return (
    <div className="shop-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} autoComplete={autoComplete} />
      {error && <span className="shop-error">{error}</span>}
    </div>
  );
}

function ThankYou({ done, currency, onBack }: { done: { code: string; lines: Line[]; total: number; label: string }; currency: string; onBack: () => void }) {
  return (
    <section className="shop-thanks">
      <h2>Order received</h2>
      <p>{done.label}. We confirm payment by hand and contact you through the phone number or e-mail you gave.</p>
      <div className="shop-code-label">Your confirmation code</div>
      <div className="shop-code">{done.code}</div>
      <p className="shop-hint">Take a screenshot of this page.</p>
      <ul className="shop-lines">
        {done.lines.map((l) => <li key={l.key}><div><b>{l.p!.product.name}</b>{l.p!.variant.name && <span className="shop-line-variant"> · {l.p!.variant.name}</span>}</div><span>{l.qty} ×</span><span className="shop-money shop-line-total">{formatMoney(l.qty * l.p!.price.unitPrice, currency)}</span></li>)}
      </ul>
      <div className="shop-total"><span>Total</span><span className="shop-money">{formatMoney(done.total, currency)}</span></div>
      <button type="button" className="shop-btn" onClick={onBack}>Back to the shop</button>
    </section>
  );
}
