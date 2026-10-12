import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { onCall, onRequest, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { logger } from 'firebase-functions';
import Busboy from 'busboy';
import { Jotform, questionParams, type JotformSubmission } from './jotform';
import { expandLines } from './bundle';
import type { Batch, Event, Item, Order, RawLine } from './types';

initializeApp();
const db = getFirestore();

// ---- Params ----
const JOTFORM_API_KEY = defineSecret('JOTFORM_API_KEY');
const JOTFORM_API_BASE = defineString('JOTFORM_API_BASE', { default: 'https://api.jotform.com' });
const REGION = 'asia-southeast1';
setGlobalOptions({ region: REGION, maxInstances: 5 });

const jot = () => new Jotform(JOTFORM_API_KEY.value(), JOTFORM_API_BASE.value());

// ---- Helpers ----

async function requireStaff(req: CallableRequest): Promise<string> {
  const email = req.auth?.token.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', 'Sign in first.');
  const snap = await db.collection('staff').doc(email).get();
  if (!snap.exists || snap.data()?.active !== true) throw new HttpsError('permission-denied', 'Not an active staff account.');
  return email;
}

async function loadBatch(batchId: string): Promise<{ batch: Batch; event: Event }> {
  const bs = await db.collection('batches').doc(batchId).get();
  if (!bs.exists) throw new HttpsError('not-found', 'Batch not found.');
  const batch = { id: bs.id, ...(bs.data() as Omit<Batch, 'id'>) };
  const es = await db.collection('events').doc(batch.eventId).get();
  if (!es.exists) throw new HttpsError('not-found', 'Event not found.');
  return { batch, event: { id: es.id, ...(es.data() as Omit<Event, 'id'>) } };
}

async function loadItems(): Promise<Map<string, Item>> {
  const snap = await db.collection('items').get();
  return new Map(snap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<Item, 'id'>) }]));
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '');
/** JotForm question `name` for an offering entry. Deterministic so sync can diff by name. */
const fieldName = (e: { itemId: string; variantId?: string }, item: Item) =>
  item.kind === 'bundle' ? `b_${sanitize(e.itemId)}` : `v_${sanitize(e.itemId)}_${sanitize(e.variantId ?? 'default')}`;
const fieldTarget = (e: { itemId: string; variantId?: string }, item: Item) =>
  item.kind === 'bundle' ? e.itemId : `${e.itemId}:${e.variantId ?? 'default'}`;

const money = (n: number) => n.toLocaleString('en-US');

interface Spec { name: string; target?: string; q: Record<string, string> }

/** Question specs for a batch, in form order. Customer block first, then one number field per offering entry grouped by type. */
function buildSpecs(batch: Batch, event: Event, items: Map<string, Item>): Spec[] {
  const specs: Spec[] = [];
  let order = 1;
  const push = (name: string, q: Record<string, string>, target?: string) => { specs.push({ name, target, q: { ...q, name, order: String(order++) } }); };

  push('intro', { type: 'control_head', text: `${event.name} · Batch ${batch.number} preorder`, subHeader: batch.mode === 'post' ? 'Post-event mail order.' : 'Choose pickup at the booth or mail delivery.' });
  push('name', { type: 'control_textbox', text: 'Your name', required: 'Yes' });
  push('email', { type: 'control_email', text: 'Email', required: 'Yes', validation: 'Email' });
  push('phone', { type: 'control_textbox', text: 'Phone / messaging handle', required: 'Yes' });
  if (batch.mode !== 'post') push('fulfilment', { type: 'control_radio', text: 'How would you like to receive your order?', required: 'Yes', options: 'Pickup at the event|Mail delivery' });
  push('address', { type: 'control_textarea', text: batch.mode === 'post' ? 'Shipping address' : 'Shipping address (only for mail delivery)', required: batch.mode === 'post' ? 'Yes' : 'No' });

  // Offering grouped by type, preserving offering order within a type.
  const groups = new Map<string, { e: Batch['offering'][number]; item: Item }[]>();
  for (const e of batch.offering) {
    const item = items.get(e.itemId);
    if (!item) continue;
    const t = item.kind === 'bundle' ? 'Bundles' : item.type;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push({ e, item });
  }
  for (const [type, entries] of groups) {
    push(`head_${sanitize(type)}`, { type: 'control_head', text: type.charAt(0).toUpperCase() + type.slice(1) });
    for (const { e, item } of entries) {
      const v = item.kind === 'product' ? item.variants?.find((x) => x.id === e.variantId) : undefined;
      const label = v ? `${item.name} · ${v.name}` : item.name;
      const price = e.overridePrice ?? (typeof v?.price === 'number' ? v.price : item.price);
      push(fieldName(e, item), { type: 'control_number', text: `${label} (${money(price)})`, required: 'No', minValue: '0', maxValue: '99', defaultValue: '0', subLabel: 'quantity' }, fieldTarget(e, item));
    }
  }
  push('submit', { type: 'control_button', text: 'Submit preorder' });
  return specs;
}

function formPatchFromQuestions(specs: Spec[], questions: Record<string, { qid: string; name: string }>) {
  const byName = new Map(Object.values(questions).map((q) => [q.name, q.qid]));
  const fieldMap: Record<string, string> = {};
  for (const s of specs) if (s.target && byName.has(s.name)) fieldMap[byName.get(s.name)!] = s.target;
  const cf = (n: string) => byName.get(n) ?? '';
  return { fieldMap, customerFields: { name: cf('name'), email: cf('email'), phone: cf('phone'), fulfilment: cf('fulfilment') || undefined, address: cf('address') } };
}

// ---- Submission import (shared by webhook and re-import) ----

const parseJotDate = (s: string) => { const t = Date.parse(s.replace(' ', 'T') + 'Z'); return Number.isFinite(t) ? t : Date.now(); };
const answerText = (a: { answer?: unknown } | undefined): string => {
  if (!a || a.answer === undefined || a.answer === null) return '';
  if (typeof a.answer === 'string' || typeof a.answer === 'number') return String(a.answer).trim();
  if (typeof a.answer === 'object') return Object.values(a.answer as Record<string, unknown>).filter((x) => typeof x === 'string').join(' ').trim();
  return '';
};

async function importSubmission(batch: Batch, sub: JotformSubmission, items: Map<string, Item>): Promise<'created' | 'updated' | 'skipped'> {
  const form = batch.form!;
  const rawLines: RawLine[] = [];
  for (const [qid, target] of Object.entries(form.fieldMap)) {
    const qty = Math.round(Number(answerText(sub.answers[qid])));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const isBundle = !target.includes(':');
    const [itemId, variantId] = isBundle ? [target, undefined] : target.split(':');
    const item = items.get(itemId);
    if (!item) { logger.warn('submission references unknown item', { sub: sub.id, target }); continue; }
    rawLines.push({ itemId, variantId, qty, unitPrice: item.price, lineTotal: item.price * qty });
  }
  if (rawLines.length === 0) return 'skipped';

  const cf = form.customerFields;
  const fulText = cf.fulfilment ? answerText(sub.answers[cf.fulfilment]).toLowerCase() : 'mail';
  const fulfilment: Order['fulfilment'] = batch.mode === 'post' || fulText.startsWith('mail') ? 'mail' : 'pickup';
  const customer = { name: answerText(sub.answers[cf.name]) || 'Unknown', email: answerText(sub.answers[cf.email]), phone: answerText(sub.answers[cf.phone]), address: answerText(sub.answers[cf.address]) || undefined };
  const lines = expandLines(rawLines, items);
  const total = rawLines.reduce((s, l) => s + l.lineTotal, 0);
  const now = Date.now();

  const existing = await db.collection('orders').where('externalId', '==', sub.id).limit(1).get();
  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    const prev = existing.docs[0].data() as Order;
    const patch: Partial<Order> = { customer: { ...customer, address: customer.address ?? prev.customer?.address }, updatedAt: now, updatedBy: 'jotform' };
    const open = prev.status === 'awaiting_pickup' || prev.status === 'awaiting_shipment';
    if (open) { Object.assign(patch, { rawLines, lines, total, fulfilment, status: fulfilment === 'pickup' ? 'awaiting_pickup' : 'awaiting_shipment' }); }
    await ref.update(stripUndefined(patch));
    return 'updated';
  }
  const order: Order = {
    eventId: batch.eventId, batchId: batch.id, source: 'jotform', externalId: sub.id, submittedAt: parseJotDate(sub.created_at),
    customer, fulfilment, status: fulfilment === 'pickup' ? 'awaiting_pickup' : 'awaiting_shipment',
    rawLines, lines, total, notes: '', createdAt: now, updatedAt: now, updatedBy: 'jotform',
  };
  await db.collection('orders').add(stripUndefined(order));
  return 'created';
}

function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = stripUndefined(x);
    return out as T;
  }
  return v;
}

async function batchByFormId(formId: string): Promise<Batch | null> {
  const snap = await db.collection('batches').where(new FieldPath('form', 'formId'), '==', formId).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...(snap.docs[0].data() as Omit<Batch, 'id'>) };
}

// ---- Callables ----

export const jotformStatus = onCall({ secrets: [JOTFORM_API_KEY] }, async (req) => {
  await requireStaff(req);
  try {
    const u = await jot().user();
    return { ok: true, username: u.username };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Unknown error' };
  }
});

export const generateForm = onCall({ secrets: [JOTFORM_API_KEY] }, async (req) => {
  const by = await requireStaff(req);
  const batchId = String(req.data?.batchId ?? '');
  const { batch, event } = await loadBatch(batchId);
  if (batch.form) throw new HttpsError('already-exists', 'This batch already has a form. Use Re-sync fields instead.');
  if (!batch.offering?.length) throw new HttpsError('failed-precondition', 'The offering is empty.');

  const items = await loadItems();
  const specs = buildSpecs(batch, event, items);
  const api = jot();
  const created = await api.createForm({
    'properties[title]': `${event.name} — Batch ${batch.number} preorder`,
    'properties[thankYouMessage]': 'Thank you! We will contact you about payment.',
    ...questionParams(specs.map((s) => s.q)),
  });
  const questions = await api.getQuestions(created.id);
  const patch = formPatchFromQuestions(specs, questions);

  const webhookUrl = `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/jotformWebhook`;
  try { await api.addWebhook(created.id, webhookUrl); } catch (e) { logger.error('webhook registration failed', e); }

  await db.collection('batches').doc(batch.id).update(stripUndefined({
    form: { provider: 'jotform', formId: created.id, url: created.url, fieldMap: patch.fieldMap, customerFields: patch.customerFields, generatedAt: Date.now() },
    updatedAt: Date.now(), updatedBy: by,
  }));
  logger.info('form generated', { batchId, formId: created.id, fields: Object.keys(patch.fieldMap).length });
  return { formId: created.id, url: created.url };
});

export const syncForm = onCall({ secrets: [JOTFORM_API_KEY] }, async (req) => {
  const by = await requireStaff(req);
  const { batch, event } = await loadBatch(String(req.data?.batchId ?? ''));
  if (!batch.form) throw new HttpsError('failed-precondition', 'No form yet. Generate one first.');
  const items = await loadItems();
  const api = jot();
  const specs = buildSpecs(batch, event, items);
  const existing = await api.getQuestions(batch.form.formId);
  const existingByName = new Map(Object.values(existing).map((q) => [q.name, q]));

  // Add item fields that are missing; remove item fields no longer offered. Customer fields are left alone.
  const wanted = specs.filter((s) => s.target);
  const toAdd = wanted.filter((s) => !existingByName.has(s.name));
  const wantedNames = new Set(wanted.map((s) => s.name));
  const toDelete = Object.values(existing).filter((q) => (q.name.startsWith('v_') || q.name.startsWith('b_')) && !wantedNames.has(q.name));
  if (toAdd.length) await api.addQuestions(batch.form.formId, questionParams(toAdd.map((s) => s.q)));
  for (const q of toDelete) await api.deleteQuestion(batch.form.formId, q.qid);

  const questions = await api.getQuestions(batch.form.formId);
  const patch = formPatchFromQuestions(specs, questions);
  await db.collection('batches').doc(batch.id).update(stripUndefined({
    form: { ...batch.form, fieldMap: patch.fieldMap, customerFields: { ...batch.form.customerFields, ...patch.customerFields } },
    updatedAt: Date.now(), updatedBy: by,
  }));
  return { ok: true as const, fields: Object.keys(patch.fieldMap).length };
});

export const setFormStatus = onCall({ secrets: [JOTFORM_API_KEY] }, async (req) => {
  await requireStaff(req);
  const { batch } = await loadBatch(String(req.data?.batchId ?? ''));
  if (!batch.form) return { ok: true as const };
  await jot().setProperties(batch.form.formId, { status: req.data?.enabled ? 'ENABLED' : 'DISABLED' });
  return { ok: true as const };
});

export const reimportBatch = onCall({ secrets: [JOTFORM_API_KEY], timeoutSeconds: 300 }, async (req) => {
  await requireStaff(req);
  const { batch } = await loadBatch(String(req.data?.batchId ?? ''));
  if (!batch.form) throw new HttpsError('failed-precondition', 'No form yet.');
  const items = await loadItems();
  const subs = await jot().allSubmissions(batch.form.formId);
  const counts = { imported: 0, updated: 0, skipped: 0 };
  for (const sub of subs) {
    const r = await importSubmission(batch, sub, items);
    if (r === 'created') counts.imported++; else if (r === 'updated') counts.updated++; else counts.skipped++;
  }
  logger.info('reimport done', { batchId: batch.id, ...counts });
  return counts;
});

// ---- Webhook ----

/** JotForm posts multipart/form-data. We only need formID and submissionID, then fetch the submission via the API. */
function parseMultipart(req: { headers: Record<string, string | string[] | undefined>; rawBody?: Buffer; body?: unknown }): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] ?? '');
    if (!ct.includes('multipart/form-data')) {
      const b = (req.body ?? {}) as Record<string, unknown>;
      resolve(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v)])));
      return;
    }
    const fields: Record<string, string> = {};
    const bb = Busboy({ headers: { 'content-type': ct } });
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('finish', () => resolve(fields));
    bb.on('error', reject);
    bb.end(req.rawBody ?? Buffer.alloc(0));
  });
}

export const jotformWebhook = onRequest({ secrets: [JOTFORM_API_KEY] }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  try {
    const fields = await parseMultipart(req);
    const formId = fields.formID ?? fields.formId ?? '';
    const submissionId = fields.submissionID ?? fields.submissionId ?? '';
    if (!formId || !submissionId) { res.status(400).send('formID and submissionID required'); return; }
    const batch = await batchByFormId(formId);
    if (!batch?.form) { logger.warn('webhook for unknown form', { formId }); res.status(200).send('ignored'); return; }
    const [items, sub] = await Promise.all([loadItems(), jot().getSubmission(submissionId)]);
    const result = await importSubmission(batch, sub, items);
    logger.info('webhook import', { formId, submissionId, result });
    res.status(200).send(result);
  } catch (e) {
    logger.error('webhook failed', e);
    res.status(500).send('error');
  }
});
