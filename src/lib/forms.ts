// In-house preorder form: defaults, resolution of the layout against a batch offering, and the
// published snapshot customers read. Pure functions; Firestore writes live in repo.ts.
import type {
  Batch, Event, FormBlock, FormBlockType, FormDoc, FormSettings, FormTheme, Item, Media, OfferingEntry,
  ProductsSource, PublicBlock, PublicForm, PublicProduct, PublicProductGroup, Settings,
} from '@/types';
import { DEFAULT_VARIANT_ID, newId, variantKey, variantOf, variantPrice } from './keys';
import { addDaysIso, formatDate, titleCase } from './format';

// ---- Labels: every customer-facing string, editable per form (phase 2 adds the editor). ----

export const DEFAULT_FORM_LABELS = {
  name: 'Name (Nama)',
  namePlaceholder: 'Name we should write on your order',
  email: 'E-mail',
  phone: 'Phone Number (No. Telp)',
  phoneHint: 'WhatsApp number preferred',
  fulfilment: 'OTS or Mail Order',
  pickup: 'OTS Pick Up (ambil di booth)',
  mail: 'Mail Order (dikirim)',
  pickupDay: 'Pick Up Date',
  pickupDayPlaceholder: 'Choose a day',
  address: 'Shipping Address (Alamat)',
  addressHint: 'Street, subdistrict (kecamatan), city, province, postal code',
  notes: 'Notes',
  notesPlaceholder: 'Anything we should know',
  paymentProof: 'Proof of Payment (Bukti Transfer)',
  paymentProofHint: 'Upload photo/screenshot of receipt or transfer slip (JPG, PNG, PDF up to 10 MB)',
  paymentProofOptional: '(optional)',
  paymentProofUploading: 'Uploading receipt…',
  removePaymentProof: 'Remove receipt',
  quantity: 'Qty',
  total: 'Total',
  yourOrder: 'Your order',
  emptyOrder: 'Pick at least one item.',
  submit: 'Submit preorder',
  submitting: 'Sending…',
  required: 'Required',
  invalidEmail: 'That e-mail address does not look right.',
  submitError: 'Could not submit. Check your connection and try again.',
  thankYouTitle: 'Order received!',
  orderCode: 'Your confirmation code',
  keepCode: 'Screenshot this page. We will contact you about payment.',
  closedTitle: 'This form is closed',
  notFound: 'This form does not exist or has not been published yet.',
  preview: 'Preview. Nothing is sent from this page.',
} as const;

export type FormLabelKey = keyof typeof DEFAULT_FORM_LABELS;
export const labelOf = (labels: Record<string, string> | undefined, k: FormLabelKey): string => labels?.[k] || DEFAULT_FORM_LABELS[k];

export const DEFAULT_THEME: FormTheme = {
  background: '#FBF8EE', surface: '#FFFFFF', accent: '#2A5BD7', text: '#26241F', font: 'sans', width: 'widescreen', radius: 'soft',
};

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  theme: FormTheme;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'cream',
    name: 'Warm Cream',
    description: 'Classic circle default with warm editorial feel',
    theme: { background: '#FBF8EE', surface: '#FFFFFF', accent: '#2A5BD7', text: '#26241F', font: 'sans', width: 'widescreen', radius: 'soft' },
  },
];

export const BLOCK_NAMES: Record<FormBlockType, string> = {
  header: 'Header', logo: 'Logo', text: 'Text', image: 'Image', divider: 'Divider', section: 'Section title',
  products: 'Products', payment_instructions: 'Payment & QRIS', customer: 'Customer details', fulfilment: 'Pickup or mail', notes: 'Notes', submit: 'Submit button',
};

// ---- Keys and codes ----

export const offeringKey = (e: OfferingEntry) => (e.variantId ? variantKey(e.itemId, e.variantId) : e.itemId);

/** Short code for order IDs: the event's code, else "(CF23)" from the name, else initials. */
export function eventCode(event: Pick<Event, 'name' | 'code'>): string {
  const explicit = (event.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (explicit) return explicit;
  const m = event.name.match(/\(([A-Za-z0-9]+)\)/);
  if (m) return m[1].toUpperCase();
  const initials = event.name.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean).map((w) => w[0]).join('').toUpperCase();
  return initials || 'EVENT';
}

/** `<eventcode>_<batchnumber>_<sequence>` with a 4-digit sequence, e.g. CF23_1_0002. */
export const transactionId = (event: Pick<Event, 'name' | 'code'>, batch: Pick<Batch, 'number'>, seq: number) =>
  `${eventCode(event)}_${batch.number}_${String(seq).padStart(4, '0')}`;

/** "Day 1 (31 Oct 2026)" for each event day, up to a week. Empty when the dates are unknown. */
export function pickupDaysFor(event: Pick<Event, 'startDate' | 'endDate'>): string[] {
  if (!event.startDate) return [];
  const out: string[] = [];
  let iso = event.startDate;
  for (let i = 1; i <= 7; i++) {
    out.push(`Day ${i} (${formatDate(iso)})`);
    if (!event.endDate || iso >= event.endDate) break;
    iso = addDaysIso(iso, 1);
  }
  return out;
}

export const defaultSettings = (event: Event): FormSettings => ({
  pickupDays: pickupDaysFor(event),
  maxQtyPerLine: 20,
  requirePhone: true,
  requireEmail: true,
  thankYouMessage: 'Thank you! We will contact you about payment through the number or e-mail you gave.',
  closedMessage: 'Preorders for this batch are closed. Follow our socials for the next window.',
});

export function newBlock(type: FormBlockType): FormBlock {
  const id = newId(6);
  switch (type) {
    case 'header': return { id, type, title: 'Title', subtitle: '' };
    case 'logo': return { id, type, imageId: '', background: 'transparent', align: 'center', marginLeft: 0, marginRight: 0, size: 'md' };
    case 'text': return { id, type, text: '' };
    case 'image': return { id, type, imageId: '', size: 'full' };
    case 'divider': return { id, type };
    case 'section': return { id, type, title: 'Section' };
    case 'products': return { id, type, source: { kind: 'all' }, layout: 'grid', columns: 3, showThumbnails: true, showPrices: true };
    case 'payment_instructions': return { id, type, title: 'Payment details (Cara Pembayaran)', text: 'Scan QRIS below or transfer to circle bank account.', imageId: '' };
    case 'customer': return { id, type };
    case 'fulfilment': return { id, type };
    case 'notes': return { id, type };
    case 'submit': return { id, type };
  }
}

/** Default layout from the offering: one products block per item type in offering order, bundles last. */
export function defaultBlocks(batch: Batch, event: Event, items: Map<string, Item>): FormBlock[] {
  const blocks: FormBlock[] = [];
  blocks.push({ id: newId(6), type: 'header', title: event.name, subtitle: batch.mode === 'post' ? 'Post-event mail order' : `Batch ${batch.number} preorder` });
  blocks.push({ id: newId(6), type: 'text', text: batch.mode === 'post' ? 'Orders from this form are shipped by mail after the event.' : 'Choose pickup at the booth or mail delivery. We confirm payment details after you submit.' });
  blocks.push({ id: newId(6), type: 'customer' });
  if (batch.mode !== 'post') blocks.push({ id: newId(6), type: 'fulfilment' });
  const types: string[] = [];
  let bundles = false;
  for (const e of batch.offering) {
    const item = items.get(e.itemId);
    if (!item) continue;
    if (item.kind === 'bundle') { bundles = true; continue; }
    if (!types.includes(item.type)) types.push(item.type);
  }
  for (const t of types) blocks.push({ id: newId(6), type: 'products', title: titleCase(t), source: { kind: 'type', type: t }, layout: 'grid', columns: 3, showThumbnails: true, showPrices: true });
  if (bundles) blocks.push({ id: newId(6), type: 'products', title: 'Bundles', source: { kind: 'bundles' }, layout: 'grid', columns: 3, showThumbnails: true, showPrices: true });
  blocks.push({ id: newId(6), type: 'notes' });
  blocks.push({ id: newId(6), type: 'submit' });
  return blocks;
}

export function newFormDoc(batch: Batch, event: Event, items: Map<string, Item>): Omit<FormDoc, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'> {
  return {
    eventId: event.id,
    batchId: batch.id,
    title: `${event.name} · ${batch.mode === 'post' ? 'Post-event mail order' : `Batch ${batch.number} preorder`}`,
    theme: { ...DEFAULT_THEME },
    blocks: defaultBlocks(batch, event, items),
    labels: {},
    settings: defaultSettings(event),
    enabled: false,
  };
}

// ---- Resolution against the offering ----

export function resolveSource(source: ProductsSource, batch: Batch, items: Map<string, Item>): OfferingEntry[] {
  const offered = batch.offering.filter((e) => items.has(e.itemId));
  switch (source.kind) {
    case 'all': return offered;
    case 'bundles': return offered.filter((e) => items.get(e.itemId)!.kind === 'bundle');
    case 'type': return offered.filter((e) => { const i = items.get(e.itemId)!; return i.kind === 'product' && i.type === source.type; });
    case 'entries': { const want = new Set(source.keys); return offered.filter((e) => want.has(offeringKey(e))); }
    case 'search': {
      const q = (source.query || '').trim().toLowerCase();
      if (!q) return [];
      const words = q.split(/\s+/).filter(Boolean);
      return offered.filter((e) => {
        const item = items.get(e.itemId);
        if (!item) return false;
        const v = item.kind === 'product' ? variantOf(item, e.variantId) : undefined;
        const haystack = `${item.name} ${item.type || ''} ${v?.name || ''} ${v?.sku || ''}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
    }
  }
}

/** Converts any products source filter into hand-picked entries, excluding the specified item keys. */
export function convertSourceToEntriesWithoutItem(
  source: ProductsSource,
  batch: Batch,
  items: Map<string, Item>,
  keysToRemove: string[],
): ProductsSource {
  const removeSet = new Set(keysToRemove);
  if (source.kind === 'entries') {
    return {
      kind: 'entries',
      keys: source.keys.filter((k) => !removeSet.has(k)),
    };
  }
  const currentEntries = resolveSource(source, batch, items);
  const nextKeys = currentEntries.map(offeringKey).filter((k) => !removeSet.has(k));
  return {
    kind: 'entries',
    keys: nextKeys,
  };
}

export function entryPrice(e: OfferingEntry, item: Item): number {
  if (typeof e.overridePrice === 'number') return e.overridePrice;
  return item.kind === 'bundle' ? item.price : variantPrice(item, e.variantId);
}

function groupsFor(entries: OfferingEntry[], items: Map<string, Item>, media: Map<string, Media>): PublicProductGroup[] {
  const groups: PublicProductGroup[] = [];
  const byItem = new Map<string, PublicProductGroup>();
  const thumb = (id?: string) => {
    if (!id) return undefined;
    const m = media.get(id);
    return m?.url || m?.dataUrl;
  };
  for (const e of entries) {
    const item = items.get(e.itemId);
    if (!item) continue;
    let g = byItem.get(item.id);
    if (!g) {
      g = { itemId: item.id, name: item.name, kind: item.kind, thumb: thumb(item.thumbnailId), products: [] };
      byItem.set(item.id, g);
      groups.push(g);
    }
    const variantId = item.kind === 'bundle' ? undefined : (e.variantId ?? DEFAULT_VARIANT_ID);
    const v = variantOf(item, variantId);
    const p: PublicProduct = {
      key: offeringKey(e), itemId: item.id, variantId, name: item.name, variantName: v?.name ?? '',
      price: entryPrice(e, item), thumb: thumb(v?.thumbnailId),
    };
    g.products.push(p);
  }
  return groups;
}

export function buildPublicForm(form: FormDoc, batch: Batch, event: Event, items: Map<string, Item>, media: Map<string, Media>, settings: Settings, version: number): Omit<PublicForm, 'id'> {
  const blocks: PublicBlock[] = [];
  const pfItems: PublicForm['items'] = {};
  for (const b of form.blocks) {
    if (b.type === 'products') {
      const groups = groupsFor(resolveSource(b.source, batch, items), items, media);
      if (groups.length === 0) continue; // nothing on offer for this block
      for (const g of groups) for (const p of g.products) pfItems[p.key] = { name: p.name, variantName: p.variantName, price: p.price, kind: g.kind };
      blocks.push({ ...b, groups });
    } else if (b.type === 'header') {
      const m = b.imageId ? media.get(b.imageId) : undefined;
      blocks.push({ ...b, src: m?.url || m?.dataUrl });
    } else if (b.type === 'image') {
      const m = b.imageId ? media.get(b.imageId) : undefined;
      const src = m?.url || m?.dataUrl;
      if (src) blocks.push({ ...b, src });
    } else if (b.type === 'logo') {
      const m = b.imageId ? media.get(b.imageId) : undefined;
      const src = m?.url || m?.dataUrl;
      blocks.push({ ...b, src });
    } else if (b.type === 'payment_instructions') {
      const m = b.imageId ? media.get(b.imageId) : undefined;
      const src = m?.url || m?.dataUrl;
      blocks.push({ ...b, src });
    } else if (b.type === 'fulfilment' && batch.mode === 'post') {
      continue; // post batches are mail only
    } else {
      blocks.push({ ...b });
    }
  }
  return {
    formId: form.id, eventId: event.id, batchId: batch.id, enabled: form.enabled, mode: batch.mode,
    title: form.title, theme: form.theme, labels: form.labels ?? {}, settings: form.settings, currency: settings.currency,
    blocks, items: pfItems, maxQtyPerLine: form.settings.maxQtyPerLine, publishedAt: Date.now(), version,
  };
}

/** Firestore documents are capped at 1 MiB; keep a margin for field names and encoding. */
export const PUBLIC_FORM_LIMIT = 950_000;

export function publicFormSize(pf: Omit<PublicForm, 'id'>): number {
  return new TextEncoder().encode(JSON.stringify(pf)).length;
}

/** Throws a readable error naming the heaviest images when the snapshot would not fit. */
export function assertPublicFormFits(pf: Omit<PublicForm, 'id'>): void {
  const size = publicFormSize(pf);
  if (size <= PUBLIC_FORM_LIMIT) return;
  const weights: { name: string; bytes: number }[] = [];
  for (const b of pf.blocks) {
    if (b.src) weights.push({ name: b.type === 'header' ? 'Header image' : 'Image block', bytes: b.src.length });
    for (const g of b.groups ?? []) {
      if (g.thumb) weights.push({ name: g.name, bytes: g.thumb.length });
      for (const p of g.products) if (p.thumb) weights.push({ name: `${g.name} · ${p.variantName}`, bytes: p.thumb.length });
    }
  }
  weights.sort((a, b) => b.bytes - a.bytes);
  const top = weights.slice(0, 3).map((w) => `${w.name} (${Math.round(w.bytes / 1024)} KB)`).join(', ');
  throw new Error(`The published form would be ${Math.round(size / 1024)} KB, over the ${Math.round(PUBLIC_FORM_LIMIT / 1024)} KB limit. Replace the heaviest images: ${top}.`);
}

/** Cheap stable hash of what publish would produce, to show "changed since publish". */
export function formHash(form: FormDoc, batch: Batch, items: Map<string, Item>): string {
  const offering = batch.offering.map((e) => { const i = items.get(e.itemId); return i ? [offeringKey(e), i.name, variantOf(i, e.variantId)?.name ?? '', entryPrice(e, i), i.thumbnailId ?? '', variantOf(i, e.variantId)?.thumbnailId ?? ''] : null; });
  const s = JSON.stringify([form.title, form.theme, form.blocks, form.labels, form.settings, form.enabled, batch.mode, offering]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Every media id a form definition references. */
export function formMediaIds(form: FormDoc, batch: Batch, items: Map<string, Item>): string[] {
  const ids: string[] = [];
  for (const b of form.blocks) {
    if (b.type === 'header' && b.imageId) ids.push(b.imageId);
    if (b.type === 'logo' && b.imageId) ids.push(b.imageId);
    if (b.type === 'image' && b.imageId) ids.push(b.imageId);
    if (b.type === 'payment_instructions' && b.imageId) ids.push(b.imageId);
  }
  for (const e of batch.offering) {
    const item = items.get(e.itemId);
    if (!item) continue;
    if (item.thumbnailId) ids.push(item.thumbnailId);
    const v = variantOf(item, e.variantId);
    if (v?.thumbnailId) ids.push(v.thumbnailId);
  }
  return [...new Set(ids)];
}

export const formPath = (formId: string) => `/f/?id=${formId}`;
export const formUrl = (formId: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}${formPath(formId)}`;

/** Confirmation code shown to the customer. Upper-case, no ambiguous letters. */
export function confirmationCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
