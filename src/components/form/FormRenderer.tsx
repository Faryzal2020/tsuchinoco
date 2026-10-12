'use client';
/* eslint-disable @next/next/no-img-element -- images are inline data URLs, next/image cannot optimise them */

// Renders a published form snapshot for customers (and for the staff preview). Owns the
// customer's draft state and local validation; the caller decides what to do with the result.
import React, { useMemo, useState } from 'react';
import type { Fulfilment, PublicBlock, PublicForm, PublicProductGroup, Submission } from '@/types';
import { confirmationCode, labelOf, type FormLabelKey } from '@/lib/forms';
import { formatMoney } from '@/lib/format';

type Snapshot = Omit<PublicForm, 'id'>;
export type SubmissionDraft = Omit<Submission, 'id'>;

const FONTS = {
  sans: 'var(--font-jakarta), "Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, "Segoe UI", sans-serif',
};
const WIDTHS = { narrow: '520px', normal: '680px', wide: '860px' };
const RADII = { sharp: '4px', soft: '12px', round: '20px' };

export function themeStyle(theme: Snapshot['theme']): React.CSSProperties {
  return {
    '--pf-bg': theme.background, '--pf-surface': theme.surface, '--pf-accent': theme.accent, '--pf-text': theme.text,
    '--pf-font': FONTS[theme.font] ?? FONTS.sans, '--pf-width': WIDTHS[theme.width] ?? WIDTHS.normal, '--pf-radius': RADII[theme.radius] ?? RADII.soft,
  } as React.CSSProperties;
}

interface Props {
  form: Snapshot;
  /** Preview inside the staff app: nothing is sent, the closed state is ignored. */
  preview?: boolean;
  onSubmit?: (draft: SubmissionDraft) => Promise<void>;
}

interface Errors { name?: string; email?: string; phone?: string; pickupDay?: string; address?: string; lines?: string; submit?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function FormRenderer({ form, preview, onSubmit }: Props) {
  const L = (k: FormLabelKey) => labelOf(form.labels, k);
  const hasFulfilment = form.mode !== 'post' && form.blocks.some((b) => b.type === 'fulfilment');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [c, setC] = useState({ name: '', email: '', phone: '', address: '', notes: '', website: '' });
  const [fulfilment, setFulfilment] = useState<Fulfilment>(form.mode === 'post' ? 'mail' : 'pickup');
  const [pickupDay, setPickupDay] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [phase, setPhase] = useState<'form' | 'sending' | 'done'>('form');
  const [code, setCode] = useState('');

  const effectiveFulfilment: Fulfilment = form.mode === 'post' ? 'mail' : hasFulfilment ? fulfilment : 'pickup';
  const max = Math.max(1, form.maxQtyPerLine || 20);

  const chosen = useMemo(() => Object.entries(qty).filter(([, q]) => q > 0).map(([key, q]) => ({ key, qty: q, item: form.items[key] })).filter((l) => l.item), [qty, form.items]);
  const total = chosen.reduce((s, l) => s + l.qty * l.item.price, 0);

  const setQ = (key: string, v: number) => setQty((m) => ({ ...m, [key]: Math.max(0, Math.min(max, Math.round(v) || 0)) }));

  const validate = (): Errors => {
    const e: Errors = {};
    if (!c.name.trim()) e.name = L('required');
    if (form.settings.requireEmail && !c.email.trim()) e.email = L('required');
    else if (c.email.trim() && !EMAIL_RE.test(c.email.trim())) e.email = L('invalidEmail');
    if (form.settings.requirePhone && !c.phone.trim()) e.phone = L('required');
    if (effectiveFulfilment === 'pickup' && hasFulfilment && form.settings.pickupDays.length > 0 && !pickupDay) e.pickupDay = L('required');
    if (effectiveFulfilment === 'mail' && !c.address.trim()) e.address = L('required');
    if (chosen.length === 0) e.lines = L('emptyOrder');
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      const first = document.querySelector('[aria-invalid="true"], .pf-error');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const newCode = confirmationCode();
    const draft: SubmissionDraft = {
      formId: form.formId, eventId: form.eventId, batchId: form.batchId, version: form.version, code: newCode,
      customer: { name: c.name.trim(), email: c.email.trim(), phone: c.phone.trim(), ...(effectiveFulfilment === 'mail' && c.address.trim() ? { address: c.address.trim() } : {}) },
      fulfilment: effectiveFulfilment,
      ...(effectiveFulfilment === 'pickup' && pickupDay ? { pickupDay } : {}),
      notes: c.notes.trim(),
      lines: Object.fromEntries(chosen.map((l) => [l.key, l.qty])),
      submittedAt: Date.now(),
      status: 'new',
    };
    setPhase('sending');
    try {
      // Honeypot: bots fill the hidden field. Pretend it worked and write nothing.
      if (!c.website && onSubmit && !preview) await onSubmit(draft);
      setCode(newCode);
      setPhase('done');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error(err);
      setErrors({ submit: L('submitError') });
      setPhase('form');
    }
  };

  const header = form.blocks.find((b) => b.type === 'header');
  const closed = !form.enabled && !preview;

  return (
    <div className="pf" style={themeStyle(form.theme)}>
      <div className="pf-inner">
        {preview && <div className="pf-banner">{L('preview')}</div>}
        {header && <Header block={header} />}

        {closed ? (
          <div className="pf-card">
            <div className="pf-title">{L('closedTitle')}</div>
            <p style={{ marginTop: 8 }}>{form.settings.closedMessage}</p>
          </div>
        ) : phase === 'done' ? (
          <div className="pf-card" style={{ textAlign: 'center' }}>
            <div className="pf-title">{L('thankYouTitle')}</div>
            <p style={{ marginTop: 8 }}>{form.settings.thankYouMessage}</p>
            <div style={{ marginTop: 16 }}>
              <div className="pf-label">{L('orderCode')}</div>
              <div className="pf-code">{code}</div>
              <div className="pf-hint">{L('keepCode')}</div>
            </div>
            <div className="pf-summary" style={{ marginTop: 18, textAlign: 'left' }}>
              <Summary lines={chosen} total={total} currency={form.currency} L={L} />
            </div>
            <p className="pf-hint" style={{ marginTop: 12 }}>{c.name} · {effectiveFulfilment === 'pickup' ? `${L('pickup')}${pickupDay ? ` · ${pickupDay}` : ''}` : L('mail')}</p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="pf-inner">
              {form.blocks.map((b) => {
                if (b.type === 'header') return null;
                return (
                  <Block key={b.id} block={b} L={L} form={form} qty={qty} setQ={setQ} max={max} c={c} setC={setC} errors={errors}
                    fulfilment={effectiveFulfilment} setFulfilment={setFulfilment} pickupDay={pickupDay} setPickupDay={setPickupDay}
                    chosen={chosen} total={total} sending={phase === 'sending'} />
                );
              })}
              {!form.blocks.some((b) => b.type === 'submit') && (
                <SubmitBlock L={L} form={form} chosen={chosen} total={total} errors={errors} sending={phase === 'sending'} />
              )}
              {/* Honeypot, invisible to people. */}
              <div style={{ position: 'absolute', left: -9999, top: 'auto', width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
                <label>Website <input tabIndex={-1} autoComplete="off" value={c.website} onChange={(e) => setC({ ...c, website: e.target.value })} /></label>
              </div>
            </div>
          </form>
        )}
        <div className="pf-footer">{form.title}</div>
      </div>
    </div>
  );
}

function Header({ block }: { block: PublicBlock }) {
  if (block.type !== 'header') return null;
  return (
    <div className="pf-card pf-header">
      {block.src && <img src={block.src} alt="" />}
      <div className="pf-header-text">
        <div className="pf-title">{block.title}</div>
        {block.subtitle && <div className="pf-subtitle">{block.subtitle}</div>}
      </div>
    </div>
  );
}

interface BlockProps {
  block: PublicBlock;
  L: (k: FormLabelKey) => string;
  form: Snapshot;
  qty: Record<string, number>;
  setQ: (key: string, v: number) => void;
  max: number;
  c: { name: string; email: string; phone: string; address: string; notes: string; website: string };
  setC: React.Dispatch<React.SetStateAction<BlockProps['c']>>;
  errors: Errors;
  fulfilment: Fulfilment;
  setFulfilment: (f: Fulfilment) => void;
  pickupDay: string;
  setPickupDay: (d: string) => void;
  chosen: { key: string; qty: number; item: Snapshot['items'][string] }[];
  total: number;
  sending: boolean;
}

function Block(p: BlockProps) {
  const { block: b, L, form, c, setC, errors } = p;
  switch (b.type) {
    case 'text':
      return <div className="pf-card pf-text">{b.text.split(/\n{2,}/).map((para, i) => <p key={i}>{para.split('\n').map((line, j, arr) => <React.Fragment key={j}>{line}{j < arr.length - 1 && <br />}</React.Fragment>)}</p>)}</div>;
    case 'divider':
      return <hr className="pf-divider" />;
    case 'section':
      return <h2 className="pf-section">{b.title}{b.description && <small>{b.description}</small>}</h2>;
    case 'image':
      return b.src ? <div className={`pf-image ${b.size === 'half' ? 'half' : ''}`}><img src={b.src} alt={b.caption ?? ''} />{b.caption && <div className="pf-caption">{b.caption}</div>}</div> : null;
    case 'products':
      return (
        <div>
          {b.title && <h2 className="pf-section" style={{ marginBottom: 8 }}>{b.title}</h2>}
          <div className={`pf-products ${b.layout === 'grid' ? 'grid' : ''}`}>
            {(b.groups ?? []).map((g) => <ProductCard key={g.itemId} group={g} showThumb={b.showThumbnails} showPrice={b.showPrices} {...p} />)}
          </div>
        </div>
      );
    case 'customer':
      return (
        <div className="pf-card pf-grid">
          <Field label={L('name')} required error={errors.name}>
            <input className="pf-input" value={c.name} placeholder={L('namePlaceholder')} autoComplete="name" aria-invalid={!!errors.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
          </Field>
          <div className="pf-grid two">
            <Field label={L('email')} required={form.settings.requireEmail} error={errors.email}>
              <input className="pf-input" type="email" inputMode="email" value={c.email} autoComplete="email" aria-invalid={!!errors.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
            </Field>
            <Field label={L('phone')} required={form.settings.requirePhone} error={errors.phone} hint={L('phoneHint')}>
              <input className="pf-input" type="tel" inputMode="tel" value={c.phone} autoComplete="tel" aria-invalid={!!errors.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
            </Field>
          </div>
        </div>
      );
    case 'fulfilment':
      return (
        <div className="pf-card pf-grid">
          <Field label={L('fulfilment')} required>
            <div className="pf-choice">
              <label><input type="radio" name="fulfilment" checked={p.fulfilment === 'pickup'} onChange={() => p.setFulfilment('pickup')} />{L('pickup')}</label>
              <label><input type="radio" name="fulfilment" checked={p.fulfilment === 'mail'} onChange={() => p.setFulfilment('mail')} />{L('mail')}</label>
            </div>
          </Field>
          {p.fulfilment === 'pickup' && form.settings.pickupDays.length > 0 && (
            <Field label={L('pickupDay')} required error={errors.pickupDay}>
              <select className="pf-select" value={p.pickupDay} aria-invalid={!!errors.pickupDay} onChange={(e) => p.setPickupDay(e.target.value)}>
                <option value="">{L('pickupDayPlaceholder')}</option>
                {form.settings.pickupDays.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          )}
          {p.fulfilment === 'mail' && <AddressField L={L} c={c} setC={setC} error={errors.address} />}
        </div>
      );
    case 'notes':
      return (
        <div className="pf-card">
          <Field label={L('notes')}>
            <textarea className="pf-textarea" value={c.notes} placeholder={L('notesPlaceholder')} onChange={(e) => setC({ ...c, notes: e.target.value })} />
          </Field>
        </div>
      );
    case 'submit':
      return <SubmitBlock L={L} form={form} chosen={p.chosen} total={p.total} errors={errors} sending={p.sending} />;
    default:
      return null;
  }
}

function AddressField({ L, c, setC, error }: Pick<BlockProps, 'L' | 'c' | 'setC'> & { error?: string }) {
  return (
    <Field label={L('address')} required error={error} hint={L('addressHint')}>
      <textarea className="pf-textarea" value={c.address} autoComplete="street-address" aria-invalid={!!error} onChange={(e) => setC({ ...c, address: e.target.value })} />
    </Field>
  );
}

function SubmitBlock({ L, form, chosen, total, errors, sending }: Pick<BlockProps, 'L' | 'form' | 'chosen' | 'total' | 'errors' | 'sending'>) {
  // Post batches have no fulfilment block, so the address lives here.
  return (
    <div className="pf-card pf-grid">
      <div className="pf-summary">
        <div className="pf-label">{L('yourOrder')}</div>
        {chosen.length === 0 ? <div className={errors.lines ? 'pf-error' : 'pf-hint'}>{L('emptyOrder')}</div> : <Summary lines={chosen} total={total} currency={form.currency} L={L} />}
      </div>
      {errors.submit && <div className="pf-error">{errors.submit}</div>}
      <button type="submit" className="pf-submit" disabled={sending}>{sending ? L('submitting') : `${L('submit')}${total > 0 ? ` · ${formatMoney(total, form.currency)}` : ''}`}</button>
    </div>
  );
}

function Summary({ lines, total, currency, L }: { lines: BlockProps['chosen']; total: number; currency: string; L: BlockProps['L'] }) {
  return (
    <table>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key}><td>{l.qty} × {l.item.name}{l.item.variantName && ` · ${l.item.variantName}`}</td><td className="num">{formatMoney(l.qty * l.item.price, currency)}</td></tr>
        ))}
        <tr className="total"><td>{L('total')}</td><td className="num">{formatMoney(total, currency)}</td></tr>
      </tbody>
    </table>
  );
}

function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="pf-field">
      <span className="pf-label">{label}{required && <span className="req" aria-hidden="true">*</span>}</span>
      {children}
      {error ? <span className="pf-error">{error}</span> : hint ? <span className="pf-hint">{hint}</span> : null}
    </label>
  );
}

function ProductCard({ group: g, showThumb, showPrice, form, qty, setQ, max, L }: { group: PublicProductGroup; showThumb: boolean; showPrice: boolean } & Pick<BlockProps, 'form' | 'qty' | 'setQ' | 'max' | 'L'>) {
  const single = g.products.length === 1 && !g.products[0].variantName;
  const prices = new Set(g.products.map((p) => p.price));
  const samePrice = prices.size === 1;
  const anyOn = g.products.some((p) => (qty[p.key] ?? 0) > 0);
  return (
    <div className="pf-product" style={anyOn ? { borderColor: 'var(--pf-accent)' } : undefined}>
      {showThumb && (g.thumb ? <img className="pf-thumb" src={g.thumb} alt="" /> : <div className="pf-thumb" aria-hidden="true" />)}
      <div style={{ minWidth: 0 }}>
        <div className="pf-row" style={{ paddingTop: 0 }}>
          <div className="pf-row-name">
            <div className="pf-product-name">{g.name}</div>
            {showPrice && samePrice && <div className="pf-price">{formatMoney(g.products[0].price, form.currency)}</div>}
          </div>
          {single && <Stepper value={qty[g.products[0].key] ?? 0} max={max} onChange={(v) => setQ(g.products[0].key, v)} label={L('quantity')} />}
        </div>
        {!single && g.products.map((p) => (
          <div className="pf-row" key={p.key}>
            <div className="pf-row-name">
              {showThumb && p.thumb && <img className="pf-variant-thumb" src={p.thumb} alt="" />}
              <span>{p.variantName || g.name}</span>
              {showPrice && !samePrice && <small>{formatMoney(p.price, form.currency)}</small>}
            </div>
            <Stepper value={qty[p.key] ?? 0} max={max} onChange={(v) => setQ(p.key, v)} label={`${L('quantity')} ${p.variantName}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Stepper({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className={`pf-stepper ${value > 0 ? 'on' : ''}`}>
      <button type="button" aria-label="Less" disabled={value <= 0} onClick={() => onChange(value - 1)}>−</button>
      <input type="number" inputMode="numeric" min={0} max={max} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} onFocus={(e) => e.target.select()} />
      <button type="button" aria-label="More" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}
