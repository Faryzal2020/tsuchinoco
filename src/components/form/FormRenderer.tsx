'use client';
/* eslint-disable @next/next/no-img-element -- images are inline data URLs, next/image cannot optimise them */

// Renders a published form snapshot for customers (and for the staff preview). Owns the
// customer's draft state and local validation; the caller decides what to do with the result.
import React, { useMemo, useState } from 'react';
import type { Fulfilment, PublicBlock, PublicForm, PublicProductGroup, Submission } from '@/types';
import { confirmationCode, labelOf, type FormLabelKey } from '@/lib/forms';
import { formatMoney } from '@/lib/format';
import { RichText } from './richText';
import { ArrowDown, ChevronDown, ChevronUp, ShoppingCart, Trash2, XCircle } from 'lucide-react';

type Snapshot = Omit<PublicForm, 'id'>;
export type SubmissionDraft = Omit<Submission, 'id'>;

const FONTS = {
  sans: 'var(--font-jakarta), "Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, "Segoe UI", sans-serif',
  mono: 'var(--font-mono), ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};
// Desktop caps. Phones are narrower than any of these, so the width only matters on larger screens.
const WIDTHS = { narrow: '780px', normal: '1020px', wide: '1290px', widescreen: '1860px' };
const RADII = { sharp: '4px', soft: '12px', round: '20px' };
const PRICE_WEIGHTS = { normal: '400', semibold: '600', bold: '700', black: '900' };
const PRICE_SIZES = { sm: '0.875em', md: '1em', lg: '1.2em', xl: '1.45em' };

export function themeStyle(theme: Snapshot['theme']): React.CSSProperties {
  return {
    '--pf-bg': theme.background, '--pf-surface': theme.surface, '--pf-accent': theme.accent, '--pf-text': theme.text,
    '--pf-font': FONTS[theme.font] ?? FONTS.sans, '--pf-width': WIDTHS[theme.width] ?? WIDTHS.widescreen, '--pf-radius': RADII[theme.radius] ?? RADII.soft,
    '--pf-price-color': theme.priceColor || 'var(--pf-muted)',
    '--pf-price-font': theme.priceFont && theme.priceFont !== 'inherit' ? (FONTS[theme.priceFont] ?? 'inherit') : 'inherit',
    '--pf-price-weight': PRICE_WEIGHTS[theme.priceWeight ?? 'semibold'] ?? '600',
    '--pf-price-size': PRICE_SIZES[theme.priceSize ?? 'md'] ?? '1em',
  } as React.CSSProperties;
}

interface Props {
  form: Snapshot;
  /** Preview inside the staff app: nothing is sent, the closed state is ignored. */
  preview?: boolean;
  onSubmit?: (draft: SubmissionDraft, proofFile?: File) => Promise<void>;
  onRemoveProduct?: (blockId: string, keys: string[]) => void;
}

interface Errors { name?: string; email?: string; phone?: string; pickupDay?: string; address?: string; lines?: string; submit?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function FormRenderer({ form, preview, onSubmit, onRemoveProduct }: Props) {
  const L = (k: FormLabelKey) => labelOf(form.labels, k);
  const hasFulfilment = form.mode !== 'post' && form.blocks.some((b) => b.type === 'fulfilment');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [c, setC] = useState({ name: '', email: '', phone: '', address: '', notes: '', website: '' });
  const [fulfilment, setFulfilment] = useState<Fulfilment>(form.mode === 'post' ? 'mail' : 'pickup');
  const [pickupDay, setPickupDay] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
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
      if (!c.website && onSubmit && !preview) await onSubmit(draft, proofFile ?? undefined);
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
                  <Block key={b.id} block={b} preview={preview} L={L} form={form} qty={qty} setQ={setQ} max={max} c={c} setC={setC} errors={errors}
                    fulfilment={effectiveFulfilment} setFulfilment={setFulfilment} pickupDay={pickupDay} setPickupDay={setPickupDay}
                    proofFile={proofFile} setProofFile={setProofFile}
                    chosen={chosen} total={total} sending={phase === 'sending'}
                    onRemoveProduct={onRemoveProduct} />
                );
              })}
              {!form.blocks.some((b) => b.type === 'submit') && (
                <>
                  <PaymentProofBlock L={L} proofFile={proofFile} setProofFile={setProofFile} disabled={phase === 'sending'} />
                  <SubmitBlock L={L} form={form} chosen={chosen} total={total} errors={errors} sending={phase === 'sending'} hasProof={!!proofFile} />
                </>
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
      {!closed && phase === 'form' && (
        <FloatingCart
          chosen={chosen}
          total={total}
          currency={form.currency}
          max={max}
          setQ={setQ}
        />
      )}
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
  proofFile: File | null;
  setProofFile: (f: File | null) => void;
  chosen: { key: string; qty: number; item: Snapshot['items'][string] }[];
  total: number;
  sending: boolean;
  preview?: boolean;
  onRemoveProduct?: (blockId: string, keys: string[]) => void;
}

function Block(p: BlockProps) {
  const { block: b, L, form, c, setC, errors } = p;
  switch (b.type) {
    case 'text':
      return <div className="pf-card pf-text"><RichText text={b.text} /></div>;
    case 'divider':
      return <hr className="pf-divider" />;
    case 'section':
      return <h2 className="pf-section">{b.title}{b.description && <small>{b.description}</small>}</h2>;
    case 'image':
      return b.src ? <div className={`pf-image ${b.size === 'half' ? 'half' : ''}`}><img src={b.src} alt={b.caption ?? ''} />{b.caption && <div className="pf-caption">{b.caption}</div>}</div> : null;
    case 'logo': {
      if (!b.src) {
        if (!p.preview) return null;
        return (
          <div
            className={b.background === 'visible' ? 'pf-card' : ''}
            style={{
              display: 'flex',
              justifyContent: b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center',
              padding: b.background === 'visible' ? undefined : '12px 0',
            }}
          >
            <div
              className="text-xs text-ink-2 italic p-3 border border-dashed border-line rounded-lg text-center"
              style={{
                marginLeft: b.marginLeft ? `${b.marginLeft}px` : undefined,
                marginRight: b.marginRight ? `${b.marginRight}px` : undefined,
              }}
            >
              No logo uploaded yet
            </div>
          </div>
        );
      }
      const card = b.background === 'visible';
      const maxHeight = b.size === 'sm' ? 60 : b.size === 'lg' ? 140 : 90;
      return (
        <div
          className={card ? 'pf-card pf-logo' : 'pf-logo'}
          style={{
            display: 'flex',
            justifyContent: b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center',
            padding: card ? undefined : '4px 0',
          }}
        >
          <img
            src={b.src}
            alt="Logo"
            style={{
              maxHeight: `${maxHeight}px`,
              maxWidth: '100%',
              objectFit: 'contain',
              marginLeft: b.marginLeft ? `${b.marginLeft}px` : undefined,
              marginRight: b.marginRight ? `${b.marginRight}px` : undefined,
            }}
          />
        </div>
      );
    }
    case 'products': {
      const cols = b.columns ?? (b.layout === 'list' ? 1 : 3);
      // Mobile defaults to the old breakpoint behaviour: two columns once the desktop layout is a grid.
      const mcols = b.columnsMobile ?? (cols === 1 ? 1 : 2);
      const classes = ['pf-products', `pf-cols-${cols}`, `pf-mcols-${mcols}`];
      if (cols > 1) classes.push('pf-stack-d');
      if (mcols > 1) classes.push('pf-stack-m');
      if (b.fitThumbnail && b.showThumbnails) classes.push('pf-fit');
      return (
        <div>
          {b.title && <h2 className="pf-section" style={{ marginBottom: 8 }}>{b.title}</h2>}
          <div className={classes.join(' ')} style={{ '--pf-cols': cols, '--pf-mcols': mcols } as React.CSSProperties}>
            {(b.groups ?? []).map((g) => (
              <ProductCard
                key={g.itemId}
                group={g}
                showThumb={b.showThumbnails}
                showPrice={b.showPrices}
                blockId={b.id}
                onRemoveProduct={p.onRemoveProduct}
                {...p}
              />
            ))}
          </div>
        </div>
      );
    }
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
    case 'payment_instructions':
      return (
        <div className="pf-card pf-grid">
          {b.title && <div className="pf-title" style={{ fontSize: '15px' }}>{b.title}</div>}
          {b.text && (
            <div className="pf-text" style={{ fontSize: '13px', lineHeight: 1.6 }}>
              <RichText text={b.text} />
            </div>
          )}
          {b.src && (
            <div style={{ textAlign: 'center', marginTop: 6 }}>
              <img
                src={b.src}
                alt="QRIS Payment"
                style={{
                  maxWidth: '240px',
                  width: '100%',
                  borderRadius: 'var(--pf-radius)',
                  border: '1px solid rgba(0,0,0,0.1)',
                  margin: '0 auto',
                  display: 'block',
                  background: '#ffffff',
                  padding: '8px',
                }}
              />
              <span className="pf-hint" style={{ fontSize: '11px', display: 'block', marginTop: 4 }}>
                Scan QRIS to pay
              </span>
            </div>
          )}
        </div>
      );
    case 'submit':
      return (
        <React.Fragment key={b.id}>
          <PaymentProofBlock L={L} proofFile={p.proofFile} setProofFile={p.setProofFile} disabled={p.sending} />
          <SubmitBlock L={L} form={form} chosen={p.chosen} total={p.total} errors={errors} sending={p.sending} hasProof={!!p.proofFile} />
        </React.Fragment>
      );
    default:
      return null;
  }
}

function PaymentProofBlock({
  L,
  proofFile,
  setProofFile,
  disabled,
}: {
  L: (k: FormLabelKey) => string;
  proofFile: File | null;
  setProofFile: (f: File | null) => void;
  disabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  React.useEffect(() => {
    if (!proofFile || !proofFile.type.startsWith('image/')) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  const onSelect = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be smaller than 10 MB.');
      return;
    }
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      setError('Please choose an image (JPG, PNG, WebP) or PDF receipt.');
      return;
    }
    setProofFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="pf-card pf-grid">
      <Field label={L('paymentProof')} hint={L('paymentProofHint')} error={error ?? undefined}>
        {!proofFile ? (
          <div>
            <button
              type="button"
              className="pf-submit"
              style={{
                background: 'transparent',
                color: 'var(--pf-accent)',
                border: '1.5px dashed var(--pf-accent)',
                fontWeight: 600,
                padding: '12px 16px',
                fontSize: '13px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                width: 'auto',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
              <span>Upload receipt {L('paymentProofOptional')}</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => onSelect(e.target.files?.[0])}
            />
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 10,
              borderRadius: 'var(--pf-radius)',
              border: '1px solid rgba(0,0,0,0.1)',
              background: 'var(--pf-bg)',
            }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Receipt preview"
                style={{
                  width: 52,
                  height: 52,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.1)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 6,
                  background: 'var(--pf-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--pf-accent)',
                  border: '1px solid rgba(0,0,0,0.1)',
                }}
              >
                PDF
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {proofFile.name}
              </div>
              <div className="pf-hint" style={{ fontSize: 11, marginTop: 2 }}>
                {(proofFile.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setProofFile(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#dc2626',
                cursor: 'pointer',
                fontSize: 12,
                padding: '6px 10px',
                fontWeight: 600,
              }}
            >
              {L('removePaymentProof')}
            </button>
          </div>
        )}
      </Field>
    </div>
  );
}

function AddressField({ L, c, setC, error }: Pick<BlockProps, 'L' | 'c' | 'setC'> & { error?: string }) {
  return (
    <Field label={L('address')} required error={error} hint={L('addressHint')}>
      <textarea className="pf-textarea" value={c.address} autoComplete="street-address" aria-invalid={!!error} onChange={(e) => setC({ ...c, address: e.target.value })} />
    </Field>
  );
}

function SubmitBlock({ L, form, chosen, total, errors, sending, hasProof }: Pick<BlockProps, 'L' | 'form' | 'chosen' | 'total' | 'errors' | 'sending'> & { hasProof?: boolean }) {
  // Post batches have no fulfilment block, so the address lives here.
  const sendingText = hasProof ? L('paymentProofUploading') : L('submitting');
  return (
    <div className="pf-card pf-grid">
      <div className="pf-summary">
        <div className="pf-label">{L('yourOrder')}</div>
        {chosen.length === 0 ? <div className={errors.lines ? 'pf-error' : 'pf-hint'}>{L('emptyOrder')}</div> : <Summary lines={chosen} total={total} currency={form.currency} L={L} />}
      </div>
      {errors.submit && <div className="pf-error">{errors.submit}</div>}
      <button type="submit" className="pf-submit" disabled={sending}>{sending ? sendingText : `${L('submit')}${total > 0 ? ` · ${formatMoney(total, form.currency)}` : ''}`}</button>
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

function ProductCard({
  group: g,
  showThumb,
  showPrice,
  form,
  qty,
  setQ,
  max,
  L,
  blockId,
  onRemoveProduct,
}: {
  group: PublicProductGroup;
  showThumb: boolean;
  showPrice: boolean;
  blockId?: string;
  onRemoveProduct?: (blockId: string, keys: string[]) => void;
} & Pick<BlockProps, 'form' | 'qty' | 'setQ' | 'max' | 'L'>) {
  const single = g.products.length === 1 && !g.products[0].variantName;
  const prices = new Set(g.products.map((p) => p.price));
  const samePrice = prices.size === 1;
  const anyOn = g.products.some((p) => (qty[p.key] ?? 0) > 0);
  return (
    <div className="pf-product" style={{ position: 'relative', ...(anyOn ? { borderColor: 'var(--pf-accent)' } : {}) }}>
      {onRemoveProduct && blockId && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onRemoveProduct(blockId, g.products.map((p) => p.key));
          }}
          className="pf-item-delete-btn"
          title="Exclude this item (converts block to hand-picked items)"
          aria-label={`Remove ${g.name}`}
        >
          <XCircle size={18} />
        </button>
      )}
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
              {showPrice && !samePrice && <small className="pf-price pf-price-row">{formatMoney(p.price, form.currency)}</small>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Stepper value={qty[p.key] ?? 0} max={max} onChange={(v) => setQ(p.key, v)} label={`${L('quantity')} ${p.variantName}`} />
              {onRemoveProduct && blockId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onRemoveProduct(blockId, [p.key]);
                  }}
                  className="pf-variant-delete-btn"
                  title={`Exclude variant "${p.variantName}"`}
                  aria-label={`Remove ${p.variantName}`}
                >
                  <XCircle size={14} />
                </button>
              )}
            </div>
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

interface FloatingCartProps {
  chosen: { key: string; qty: number; item: Snapshot['items'][string] }[];
  total: number;
  currency: string;
  max: number;
  setQ: (key: string, v: number) => void;
}

function FloatingCart({ chosen, total, currency, max, setQ }: FloatingCartProps) {
  const [userMinimized, setUserMinimized] = useState<boolean | null>(null);
  const totalCount = chosen.reduce((acc, l) => acc + l.qty, 0);

  // Auto-expand when items are added unless user explicitly minimized
  const isMinimized = userMinimized ?? (chosen.length === 0);

  return (
    <div className="pf-floating-cart">
      {isMinimized ? (
        <button
          type="button"
          onClick={() => setUserMinimized(false)}
          className="pf-floating-cart-minimized"
          title="Expand cart summary"
          aria-label="Expand cart summary"
        >
          <div className="pf-cart-icon-wrap">
            <ShoppingCart size={17} className="pf-cart-icon" />
            {totalCount > 0 && <span className="pf-cart-count-badge">{totalCount}</span>}
          </div>
          <div className="pf-cart-min-text">
            <span className="pf-cart-min-label">
              {totalCount === 0 ? 'Cart (0)' : `${totalCount} item${totalCount === 1 ? '' : 's'}`}
            </span>
            {totalCount > 0 && (
              <span className="pf-cart-min-price">
                {formatMoney(total, currency)}
              </span>
            )}
          </div>
          <ChevronUp size={16} className="pf-cart-expand-icon" />
        </button>
      ) : (
        <div className="pf-floating-cart-card">
          <div className="pf-cart-header">
            <div className="pf-cart-title-row">
              <ShoppingCart size={18} className="pf-cart-header-icon" />
              <span className="pf-cart-title">Your Order</span>
              <span className="pf-cart-badge">
                {totalCount} {totalCount === 1 ? 'item' : 'items'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setUserMinimized(true)}
              className="pf-cart-min-btn"
              title="Minimize cart"
              aria-label="Minimize cart"
            >
              <ChevronDown size={18} />
            </button>
          </div>

          <div className="pf-cart-body">
            {chosen.length === 0 ? (
              <div className="pf-cart-empty">
                <ShoppingCart size={28} className="pf-cart-empty-icon" />
                <div className="pf-cart-empty-text">Your cart is empty</div>
                <div className="pf-cart-empty-hint">Pick items above to start your order</div>
              </div>
            ) : (
              <div className="pf-cart-items-list">
                {chosen.map((line) => (
                  <div key={line.key} className="pf-cart-item-row">
                    <div className="pf-cart-item-info">
                      <span className="pf-cart-item-name" title={line.item.name}>
                        {line.item.name}
                      </span>
                      {line.item.variantName && (
                        <span className="pf-cart-item-variant" title={line.item.variantName}>
                          {line.item.variantName}
                        </span>
                      )}
                      <span className="pf-cart-item-subtotal">
                        {formatMoney(line.qty * line.item.price, currency)}
                      </span>
                    </div>

                    <div className="pf-cart-item-actions">
                      <div className="pf-cart-stepper">
                        <button
                          type="button"
                          onClick={() => setQ(line.key, line.qty - 1)}
                          className="pf-cart-stepper-btn"
                          title="Decrease quantity"
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="pf-cart-stepper-val">{line.qty}</span>
                        <button
                          type="button"
                          onClick={() => setQ(line.key, line.qty + 1)}
                          disabled={line.qty >= max}
                          className="pf-cart-stepper-btn"
                          title="Increase quantity"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setQ(line.key, 0)}
                        className="pf-cart-remove-btn"
                        title="Remove item"
                        aria-label={`Remove ${line.item.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pf-cart-footer">
            <div className="pf-cart-total-row">
              <span className="pf-cart-total-label">Total Cost</span>
              <span className="pf-cart-total-val">{formatMoney(total, currency)}</span>
            </div>

            {chosen.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const submitEl = document.querySelector('.pf-card.pf-grid, .pf-submit, form');
                  submitEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                className="pf-cart-checkout-btn"
              >
                <span>Proceed to Details</span>
                <ArrowDown size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
