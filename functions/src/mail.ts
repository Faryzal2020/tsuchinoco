// Shared inbox and send queue (Mail phase).
// - mailWebhook: Resend's one webhook endpoint. Files mail that reaches the admin@ inbox into
//   threads (Resend Inboxes keeps the threading), mirrors Resend's spam verdicts and records
//   delivery events (sent, delivered, bounced, complained, failed) on the messages.
// - queueMail: a staff reply or new message from admin@. queueBroadcast: a personalised send.
//   Order-update e-mails are queued by functions/src/orders.ts.
// - mailQueueOnCreate sends staff and order messages straight away while the day's budget lasts;
//   drainMailQueue (every 15 minutes) sends what is still waiting, staff first, then order
//   updates, then broadcasts. Resend's free plan allows 100 e-mails a day and 3,000 a month,
//   received mail included; a quota error from Resend pauses the queue until the next reset.
// - contactOnCreate: turns a /shop/ contact-form message into an Inbox thread (no e-mail used).
// - listMailInboxes: the inboxes set up in Resend (admin@ first), for the Inbox picker. Mail and
//   replies record which inbox they belong to; mail without one belongs to the shared admin@.
import { createHash, randomUUID } from 'crypto';
import { FieldPath, FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { Resend } from 'resend';
import {
  adminAddress, ATTACHMENT_LIMITS, budgetLeft, composeMessage, CONTACT_LIMITS, OUTGOING_ATTACHMENT_PREFIX, dayKey, EMAIL_RE, formatFrom, htmlToText, isBlocked, mailSettingsOf, monthKey,
  nextDayReset, nextMonthReset, normalizeSubject, parseAddress, personalize, PRIORITY, replySubject, snippetOf, splitAddresses, textToHtml,
} from '../../src/lib/mail';
import { clean, db, getSettings, logActivity, requireStaff, resendFor, resendKey, TRIGGER_REGION } from './common';
import type { ContactSubmission, MailAttachment, MailInboxInfo, MailMessage, MailQuota, MailSettings, MailThread, OrderEmail } from '../../src/types';

const MSG = 'mailMessages';
const THR = 'mailThreads';
const QUOTA = 'mailQuota';
const INLINE_HTML_MAX = 400_000;
const TEXT_MAX = 200_000;
const ATTACHMENT_MAX = 25 * 1024 * 1024;
const STUCK_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** Pause between Resend calls; the API allows a few requests a second. */
const GAP_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msgOf = (s: DocumentSnapshot) => ({ id: s.id, ...(s.data() as Omit<MailMessage, 'id'>) }) as MailMessage;
const threadOf = (s: DocumentSnapshot) => ({ id: s.id, ...(s.data() as Omit<MailThread, 'id'>) }) as MailThread;
const msgRef = (id: string) => db().doc(`${MSG}/${id}`);
const quotaRefs = (now: number) => [db().doc(`${QUOTA}/${dayKey(now)}`), db().doc(`${QUOTA}/${monthKey(now)}`)] as const;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------------------------
// Inboxes (set up in Resend; cached for 5 minutes per instance)
// ---------------------------------------------------------------------------------------------

let inboxCache: { at: number; byId: Map<string, string>; names: Map<string, string> } | null = null;

/** Resend inbox id → lower-cased address. */
async function resendInboxes(resend: Resend): Promise<Map<string, string>> {
  if (inboxCache && Date.now() - inboxCache.at < 5 * 60_000) return inboxCache.byId;
  const byId = new Map<string, string>();
  const names = new Map<string, string>();
  let after: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const res = await resend.inboxes.list({ limit: 100, ...(after ? { after } : {}) });
    if (res.error) throw new Error(`Could not list the Resend inboxes: ${res.error.message}`);
    for (const i of res.data.data) {
      byId.set(i.id, i.email_address.toLowerCase());
      names.set(i.email_address.toLowerCase(), i.name || i.from_name || '');
    }
    if (!res.data.has_more || res.data.data.length === 0) break;
    after = res.data.data[res.data.data.length - 1].id;
  }
  inboxCache = { at: Date.now(), byId, names };
  return byId;
}

/** Inbox addresses, the shared admin@ first. */
async function inboxList(resend: Resend, m: MailSettings): Promise<string[]> {
  const admin = adminAddress(m);
  const all = [...new Set((await resendInboxes(resend)).values())].filter((a) => a !== admin).sort();
  return [admin, ...all];
}

async function inboxAddressById(resend: Resend, id: string, m: MailSettings): Promise<string> {
  try {
    const known = (await resendInboxes(resend)).get(id);
    if (known) return known;
    const res = await resend.inboxes.get(id);
    if (!res.error) return res.data.email_address.toLowerCase();
  } catch (e) {
    logger.warn('[mail] inbox lookup', id, e);
  }
  return adminAddress(m);
}

/** Store `inbox` only for the extra inboxes; mail without it belongs to the shared one. */
const inboxField = (address: string, m: MailSettings) => (address === adminAddress(m) ? {} : { inbox: address });

export const listMailInboxes = onCall({ cors: true }, async (req) => {
  await requireStaff(req);
  const settings = await getSettings();
  const m = mailSettingsOf(settings);
  const resend = resendFor(settings);
  if (!resend) return { inboxes: [{ address: adminAddress(m), name: '' }] };
  const list = await inboxList(resend, m);
  const inboxes: MailInboxInfo[] = list.map((address) => ({ address, name: inboxCache?.names.get(address) ?? '' }));
  return { inboxes };
});

/** Rename an inbox in Resend. The name is shown in the app and is the From name on its replies. */
export const renameMailInbox = onCall({ cors: true }, async (req) => {
  const staff = await requireStaff(req);
  const d = (req.data ?? {}) as { address?: string; name?: string };
  const address = (d.address ?? '').trim().toLowerCase();
  const name = (d.name ?? '').replace(/[<>"\r\n]/g, '').trim().slice(0, 80);
  if (!address || !name) throw new HttpsError('invalid-argument', 'An inbox and a name are required.');
  const settings = await getSettings();
  const resend = resendFor(settings);
  if (!resend) throw new HttpsError('failed-precondition', 'Resend is not set up: add the API key in Mail settings.');
  const m = mailSettingsOf(settings);
  if (!(await inboxList(resend, m)).includes(address)) throw new HttpsError('invalid-argument', `${address} is not one of the Resend inboxes.`);
  const res = await resend.inboxes.update(address, { name, fromName: name });
  if (res.error) throw new HttpsError('internal', `Resend could not rename the inbox: ${res.error.message}`);
  inboxCache = null;
  await logActivity('update', 'settings', `Renamed inbox ${address} to "${name}"`, { entityName: address, by: staff.id });
  return { address, name };
});

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

type Outcome =
  | { ok: true; resendId: string }
  | { ok: false; kind: 'quota-day' | 'quota-month' | 'retry' | 'fail'; error: string };

function classify(err: { name?: string; message?: string; statusCode?: number | null }): Outcome {
  const error = err.message || err.name || 'Resend refused the e-mail';
  if (err.name === 'daily_quota_exceeded') return { ok: false, kind: 'quota-day', error };
  if (err.name === 'monthly_quota_exceeded') return { ok: false, kind: 'quota-month', error };
  if (err.name === 'rate_limit_exceeded' || err.name === 'concurrent_idempotent_requests' || err.name === 'application_error' || err.name === 'internal_server_error' || (err.statusCode ?? 0) >= 500) {
    return { ok: false, kind: 'retry', error };
  }
  return { ok: false, kind: 'fail', error };
}

/** Claim queued messages within today's budget: they become `sending` and count toward the quota. */
async function claim(ids: string[], m: MailSettings): Promise<MailMessage[]> {
  if (ids.length === 0) return [];
  const now = Date.now();
  const [dayRef, monthRef] = quotaRefs(now);
  return db().runTransaction(async (tx) => {
    const [daySnap, monthSnap, ...snaps] = await tx.getAll(dayRef, monthRef, ...ids.map(msgRef));
    let budget = budgetLeft(daySnap.data() as MailQuota | undefined, monthSnap.data() as MailQuota | undefined, m, now);
    const out: MailMessage[] = [];
    for (const s of snaps) {
      if (budget <= 0) break;
      if (!s.exists || s.data()?.status !== 'queued') continue;
      out.push(msgOf(s));
      budget -= 1;
      tx.update(s.ref, { status: 'sending', claimedAt: now });
    }
    if (out.length > 0) {
      tx.set(dayRef, { sent: FieldValue.increment(out.length) }, { merge: true });
      tx.set(monthRef, { sent: FieldValue.increment(out.length) }, { merge: true });
    }
    return out;
  });
}

const plainPayload = (msg: MailMessage) => ({
  from: msg.from,
  to: msg.to,
  ...(msg.cc?.length ? { cc: msg.cc } : {}),
  ...(msg.bcc?.length ? { bcc: msg.bcc } : {}),
  subject: msg.subject,
  html: msg.html ?? textToHtml(msg.text),
  text: msg.text,
  ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
});

/** The files staff attached, read back from Storage. */
async function filesOf(msg: MailMessage): Promise<{ filename: string; content: Buffer; contentType: string }[]> {
  const out = [];
  for (const a of msg.attachments ?? []) {
    if (!a.path) continue;
    const [content] = await getStorage().bucket().file(a.path).download();
    out.push({ filename: a.name, content, contentType: a.type || 'application/octet-stream' });
  }
  return out;
}

/** Send one claimed message. Inbox messages go through the Resend inbox so replies thread there. */
async function deliver(resend: Resend, msg: MailMessage, m: MailSettings): Promise<Outcome> {
  try {
    const files = msg.direction === 'out' && msg.attachments?.length ? await filesOf(msg) : [];
    const attachments = files.length ? { attachments: files } : {};
    if (msg.via !== 'inbox') {
      const res = await resend.emails.send({ ...plainPayload(msg), ...attachments }, { idempotencyKey: `mail-${msg.id}` });
      return res.error ? classify(res.error) : { ok: true, resendId: res.data.id };
    }
    const emailAddress = msg.inbox ?? adminAddress(m);
    const html = msg.html ?? textToHtml(msg.text);
    const cc = { ...(msg.cc?.length ? { cc: msg.cc } : {}), ...(msg.bcc?.length ? { bcc: msg.bcc } : {}) };
    if (msg.resendThreadId && msg.replyToResendEmailId) {
      const res = await resend.inboxes.threads.emails.reply(
        { emailAddress, threadId: msg.resendThreadId, emailId: msg.replyToResendEmailId, html, text: msg.text, subject: msg.subject, ...cc, ...attachments },
        { idempotencyKey: `reply-${msg.id}` },
      );
      return res.error ? classify(res.error) : { ok: true, resendId: res.data.id };
    }
    // A new conversation (or the first reply to a contact-form message): a draft, then send it.
    const draft = await resend.inboxes.drafts.create({ emailAddress, to: msg.to, subject: msg.subject, html, text: msg.text, ...cc, ...attachments }, { idempotencyKey: `draft-${msg.id}` });
    if (draft.error) return classify(draft.error);
    await sleep(GAP_MS);
    const res = await resend.inboxes.drafts.send({ emailAddress, draftId: draft.data.id }, { idempotencyKey: `send-${msg.id}` });
    return res.error ? classify(res.error) : { ok: true, resendId: res.data.id };
  } catch (e) {
    return { ok: false, kind: 'retry', error: errText(e) };
  }
}

/** Plain messages go out up to 100 at a time through the batch endpoint. */
async function deliverBatch(resend: Resend, msgs: MailMessage[], m: MailSettings): Promise<Outcome[]> {
  if (msgs.length === 1) return [await deliver(resend, msgs[0], m)];
  const key = `batch-${createHash('sha256').update(msgs.map((x) => x.id).join(',')).digest('hex').slice(0, 40)}`;
  try {
    const res = await resend.batch.send(msgs.map(plainPayload), { idempotencyKey: key });
    if (!res.error) return msgs.map((_, i) => ({ ok: true as const, resendId: res.data.data[i]?.id ?? '' }));
    const c = classify(res.error);
    if (c.ok || c.kind !== 'fail') return msgs.map(() => c);
  } catch (e) {
    return msgs.map(() => ({ ok: false as const, kind: 'retry' as const, error: errText(e) }));
  }
  // Something in the batch was invalid: send one by one so only the bad ones fail.
  const outs: Outcome[] = [];
  for (const msg of msgs) { outs.push(await deliver(resend, msg, m)); await sleep(GAP_MS); }
  return outs;
}

/** Record the outcome on the order's e-mail log entry. */
async function updateOrderEmail(orderId: string, mailId: string, patch: Partial<OrderEmail>) {
  const ref = db().doc(`orders/${orderId}`);
  await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const emails = (s.data()?.emails ?? []) as OrderEmail[];
    if (!emails.some((e) => e.mailId === mailId)) return;
    tx.update(ref, {
      emails: emails.map((e) => {
        if (e.mailId !== mailId) return e;
        const { queued: _q, error: _e, ...rest } = e;
        void _q; void _e;
        return clean({ ...rest, ...patch });
      }),
    });
  }).catch((e) => logger.warn('[mail] order e-mail log', orderId, e));
}

async function finish(msg: MailMessage, out: Outcome) {
  const ref = msgRef(msg.id);
  const now = Date.now();
  if (out.ok) {
    await ref.update({ status: 'sent', sentAt: now, resendId: out.resendId, error: FieldValue.delete(), claimedAt: FieldValue.delete() });
    if (msg.orderId) await updateOrderEmail(msg.orderId, msg.id, { ok: true, id: out.resendId });
    return;
  }
  const [dayRef, monthRef] = quotaRefs(msg.claimedAt ?? now);
  const attempts = (msg.attempts ?? 0) + (out.kind === 'retry' ? 1 : 0);
  const giveBack = db().batch();
  // Resend did not count a refused e-mail, so neither does the queue.
  giveBack.set(dayRef, { sent: FieldValue.increment(-1), ...(out.kind === 'quota-day' ? { blockedUntil: nextDayReset(now) } : {}) }, { merge: true });
  giveBack.set(monthRef, { sent: FieldValue.increment(-1), ...(out.kind === 'quota-month' ? { blockedUntil: nextMonthReset(now) } : {}) }, { merge: true });
  if (out.kind !== 'fail' && attempts < MAX_ATTEMPTS) {
    giveBack.update(ref, { status: 'queued', attempts, error: out.error, claimedAt: FieldValue.delete() });
    await giveBack.commit();
    return;
  }
  giveBack.update(ref, { status: 'failed', attempts, error: out.error, claimedAt: FieldValue.delete() });
  await giveBack.commit();
  if (msg.threadId) await db().doc(`${THR}/${msg.threadId}`).update({ flags: FieldValue.arrayUnion('send-failed') }).catch(() => undefined);
  if (msg.orderId) await updateOrderEmail(msg.orderId, msg.id, { ok: false, error: out.error });
}

/** Send specific queued messages (from the trigger). */
async function sendQueued(ids: string[]): Promise<number> {
  const settings = await getSettings();
  const resend = resendFor(settings);
  if (!resend) { logger.warn('[mail] no Resend API key; messages stay queued'); return 0; }
  const m = mailSettingsOf(settings);
  const claimed = await claim(ids, m);
  for (const msg of claimed) {
    await finish(msg, await deliver(resend, msg, m));
    if (claimed.length > 1) await sleep(GAP_MS);
  }
  return claimed.length;
}

/** How many e-mails may still go out now: two reads, against one per queued message. */
async function budgetNow(m: MailSettings): Promise<number> {
  const now = Date.now();
  const [day, month] = await db().getAll(...quotaRefs(now));
  return budgetLeft(day.data() as MailQuota | undefined, month.data() as MailQuota | undefined, m, now);
}

/**
 * Send whatever is queued, highest priority and oldest first, until the budget or the time runs out.
 * Firestore bills every queued message a query returns, so a backlog waiting for tomorrow's (or next
 * month's) quota must not be read every 15 minutes: check the budget first and read only that many.
 */
async function drain(deadline: number): Promise<number> {
  const settings = await getSettings();
  const resend = resendFor(settings);
  if (!resend) return 0;
  const m = mailSettingsOf(settings);
  let total = 0;
  while (Date.now() < deadline) {
    const budget = Math.min(100, await budgetNow(m));
    if (budget <= 0) break;
    const q = await db().collection(MSG).where('status', '==', 'queued').orderBy('priority').orderBy('queuedAt').limit(budget).get();
    if (q.empty) break;
    const claimed = await claim(q.docs.map((d) => d.id), m);
    if (claimed.length === 0) break;
    for (const msg of claimed.filter((x) => x.via === 'inbox')) {
      await finish(msg, await deliver(resend, msg, m));
      await sleep(GAP_MS);
    }
    // The batch endpoint takes no attachments, so those go one by one.
    for (const msg of claimed.filter((x) => x.via !== 'inbox' && x.attachments?.length)) {
      await finish(msg, await deliver(resend, msg, m));
      await sleep(GAP_MS);
    }
    const plain = claimed.filter((x) => x.via !== 'inbox' && !x.attachments?.length);
    for (let i = 0; i < plain.length; i += 100) {
      const chunk = plain.slice(i, i + 100);
      const outs = await deliverBatch(resend, chunk, m);
      await Promise.all(chunk.map((msg, j) => finish(msg, outs[j])));
      await sleep(GAP_MS);
    }
    total += claimed.length;
    if (claimed.length < q.size) break; // the budget ran out
  }
  return total;
}

export const mailQueueOnCreate = onDocumentCreated({ document: `${MSG}/{id}`, region: TRIGGER_REGION }, async (ev) => {
  const d = ev.data?.data() as MailMessage | undefined;
  // Broadcasts are sent by queueBroadcast and the scheduler, in batches.
  if (!d || d.status !== 'queued' || d.source === 'broadcast') return;
  await sendQueued([ev.params.id]);
});

export const drainMailQueue = onSchedule({ schedule: 'every 15 minutes', timeZone: 'UTC', timeoutSeconds: 300 }, async () => {
  // A send that crashed half-way goes back in the queue; the idempotency key stops a double send.
  const stuck = await db().collection(MSG).where('status', '==', 'sending').where('claimedAt', '<', Date.now() - STUCK_MS).limit(200).get();
  if (!stuck.empty) {
    // Should be rare: each one is a send that died half-way. Seen every run, something keeps failing.
    logger.warn(`[mail] ${stuck.size} message(s) stuck in sending; queued again`);
    const b = db().batch();
    stuck.docs.forEach((d) => b.update(d.ref, { status: 'queued', claimedAt: FieldValue.delete() }));
    await b.commit();
  }
  await drain(Date.now() + 240_000);
});

// ---------------------------------------------------------------------------------------------
// Queueing (callables)
// ---------------------------------------------------------------------------------------------

/** A staff reply in a thread, or a new message. Always from admin@ with the caller's signature. */
export const queueMail = onCall({ cors: true }, async (req) => {
  const staff = await requireStaff(req);
  const d = (req.data ?? {}) as { threadId?: string; inbox?: string; to?: string; cc?: string; bcc?: string; subject?: string; body?: string; attachments?: { path?: string; name?: string }[] };
  const body = (d.body ?? '').trim();
  if (!body) throw new HttpsError('invalid-argument', 'Write a message first.');
  if (body.length > 50_000) throw new HttpsError('invalid-argument', 'The message is too long.');
  const cc = splitAddresses(d.cc ?? '');
  if (cc.bad.length) throw new HttpsError('invalid-argument', `Not an e-mail address: ${cc.bad.join(', ')}`);
  const bcc = splitAddresses(d.bcc ?? '');
  if (bcc.bad.length) throw new HttpsError('invalid-argument', `Not an e-mail address: ${bcc.bad.join(', ')}`);

  // Files the browser uploaded under mail/out/; sizes and types come from Storage, not the caller.
  const wanted = (d.attachments ?? []).filter((a) => a.path);
  if (wanted.length > ATTACHMENT_LIMITS.files) throw new HttpsError('invalid-argument', `At most ${ATTACHMENT_LIMITS.files} files.`);
  const attachments: MailAttachment[] = [];
  for (const a of wanted) {
    const path = String(a.path);
    if (!path.startsWith(OUTGOING_ATTACHMENT_PREFIX) || path.includes('..')) throw new HttpsError('invalid-argument', 'Unknown attachment.');
    const [meta] = await getStorage().bucket().file(path).getMetadata().catch(() => [null]);
    if (!meta) throw new HttpsError('invalid-argument', `The file ${a.name ?? path} was not uploaded.`);
    attachments.push({ name: String(a.name || path.split('/').pop()).slice(0, 200), type: meta.contentType || 'application/octet-stream', size: Number(meta.size) || 0, path });
  }
  if (attachments.reduce((n, a) => n + a.size, 0) > ATTACHMENT_LIMITS.totalBytes) throw new HttpsError('invalid-argument', 'Attachments may total at most 20 MB.');

  const settings = await getSettings();
  const m = mailSettingsOf(settings);
  const now = Date.now();

  let thread: MailThread | null = null;
  if (d.threadId) {
    const s = await db().doc(`${THR}/${d.threadId}`).get();
    if (!s.exists) throw new HttpsError('not-found', 'That conversation no longer exists.');
    thread = threadOf(s);
  }
  let to: string[];
  if (thread) to = [thread.counterpart];
  else {
    const t = splitAddresses(d.to ?? '');
    if (t.bad.length) throw new HttpsError('invalid-argument', `Not an e-mail address: ${t.bad.join(', ')}`);
    if (t.ok.length === 0) throw new HttpsError('invalid-argument', 'Add a recipient.');
    to = t.ok;
  }
  if (to.length + cc.ok.length + bcc.ok.length > 50) throw new HttpsError('invalid-argument', 'At most 50 recipients.');

  // A reply goes out from the thread's inbox; a new message from the inbox staff chose.
  let inbox = thread ? thread.inbox ?? adminAddress(m) : (d.inbox ?? '').trim().toLowerCase() || adminAddress(m);
  if (!thread && inbox !== adminAddress(m)) {
    const resend = resendFor(settings);
    if (!resend || !(await inboxList(resend, m)).includes(inbox)) throw new HttpsError('invalid-argument', `${inbox} is not one of the Resend inboxes.`);
  }
  inbox = inbox.toLowerCase();

  let quote: { from: string; at: number; text: string } | undefined;
  let replyToResendEmailId: string | undefined;
  if (thread) {
    const recent = (await db().collection(MSG).where('threadId', '==', thread.id).orderBy('at', 'desc').limit(20).get()).docs.map(msgOf);
    const q = recent.find((x) => x.direction === 'in') ?? recent[0];
    if (q) quote = { from: q.fromName ? `${q.fromName} <${q.from}>` : q.from, at: q.at, text: q.text };
    if (thread.resendThreadId) {
      const r = recent.find((x) => x.resendId && (x.direction === 'in' || x.via === 'inbox') && x.status !== 'failed');
      replyToResendEmailId = r?.resendId;
    }
  }
  const subject = thread ? replySubject(thread.subject) : ((d.subject ?? '').trim().slice(0, 300) || '(no subject)');
  const { text, html } = composeMessage({ body, signature: staff.mailSignature, quote });

  const threadRef = thread ? db().doc(`${THR}/${thread.id}`) : db().collection(THR).doc();
  const ref = db().collection(MSG).doc();
  const msg: Omit<MailMessage, 'id'> = {
    threadId: threadRef.id, direction: 'out', status: 'queued', source: 'staff', via: 'inbox', priority: PRIORITY.staff,
    from: inbox, fromName: m.fromName, to, cc: cc.ok, bcc: bcc.ok, counterpart: to[0], subject, text, html, attachments,
    sentBy: staff.id, attempts: 0, queuedAt: now, at: now, ...inboxField(inbox, m),
    ...(thread?.resendThreadId && replyToResendEmailId ? { resendThreadId: thread.resendThreadId, replyToResendEmailId } : {}),
  };
  const b = db().batch();
  b.set(ref, clean(msg));
  if (thread) {
    b.update(threadRef, 'lastAt', now, 'lastSnippet', snippetOf(body), 'lastFrom', staff.displayName, 'messageCount', FieldValue.increment(1), 'unread', false,
      new FieldPath('replying', staff.id), FieldValue.delete());
  } else {
    const t: Omit<MailThread, 'id'> = {
      subject, counterpart: to[0], folder: 'inbox', flags: [], unread: false, lastAt: now, lastSnippet: snippetOf(body),
      lastFrom: staff.displayName, messageCount: 1, createdAt: now, ...inboxField(inbox, m),
    };
    b.set(threadRef, t);
  }
  await b.commit();
  return { id: ref.id, threadId: threadRef.id };
});

interface BroadcastRecipient { email: string; name?: string; variables?: Record<string, string> }

/** A personalised send to many recipients from admin@, or a test copy to the caller. */
export const queueBroadcast = onCall({ cors: true, timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  const staff = await requireStaff(req);
  const d = (req.data ?? {}) as { recipients?: BroadcastRecipient[]; subject?: string; html?: string; test?: boolean };
  const subject = (d.subject ?? '').trim();
  const html = (d.html ?? '').trim();
  if (!subject || !html) throw new HttpsError('invalid-argument', 'Subject and message are required.');
  const recipients = (d.test ? [{ email: staff.id, name: staff.displayName, variables: d.recipients?.[0]?.variables }] : d.recipients ?? [])
    .map((r) => ({ ...r, email: (r.email ?? '').trim().toLowerCase() }))
    .filter((r) => EMAIL_RE.test(r.email));
  if (recipients.length === 0) throw new HttpsError('invalid-argument', 'At least one valid recipient is required.');
  if (recipients.length > 3000) throw new HttpsError('invalid-argument', 'At most 3,000 recipients in one broadcast.');

  const settings = await getSettings();
  if (!resendKey(settings)) throw new HttpsError('failed-precondition', 'Resend is not set up: add the API key in Mail settings.');
  const m = mailSettingsOf(settings);
  const from = formatFrom(m.fromName, adminAddress(m));
  const broadcastId = db().collection(MSG).doc().id;
  const now = Date.now();
  for (let i = 0; i < recipients.length; i += 400) {
    const b = db().batch();
    recipients.slice(i, i + 400).forEach((r, j) => {
      const vars = { name: r.name || '', email: r.email, ...(r.variables ?? {}) };
      const body = personalize(html, vars);
      const msg: Omit<MailMessage, 'id'> = {
        direction: 'out', status: 'queued', source: d.test ? 'staff' : 'broadcast', via: 'plain', priority: d.test ? PRIORITY.staff : PRIORITY.broadcast,
        from, fromName: m.fromName, to: [formatFrom(r.name, r.email)], counterpart: r.email,
        subject: `${d.test ? '[TEST] ' : ''}${personalize(subject, vars)}`.slice(0, 300), html: body, text: htmlToText(body).slice(0, TEXT_MAX), attachments: [],
        sentBy: staff.id, broadcastId, attempts: 0, queuedAt: now + i + j, at: now,
      };
      b.set(db().collection(MSG).doc(), clean(msg));
    });
    await b.commit();
  }
  // A test is sent by the trigger like a staff message; a broadcast goes out here, then by the scheduler.
  const sentNow = d.test ? 0 : await drain(Date.now() + 200_000);
  return { broadcastId, queued: recipients.length, sentNow, waiting: d.test ? 0 : recipients.length - sentNow, resetAt: nextDayReset(Date.now()) };
});

// ---------------------------------------------------------------------------------------------
// Receiving (webhook)
// ---------------------------------------------------------------------------------------------

async function saveFile(path: string, data: Buffer, contentType: string) {
  await getStorage().bucket().file(path).save(data, {
    resumable: false,
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: randomUUID() } },
  });
}

const safeName = (s: string) => (s || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);

async function copyAttachments(resend: Resend, emailId: string, docId: string, listed: { id: string; filename: string | null; size: number | null }[]): Promise<MailAttachment[]> {
  if (listed.length === 0) return [];
  const out: MailAttachment[] = listed.map((a) => ({ name: a.filename || 'attachment', type: '', size: a.size ?? 0, path: '' }));
  try {
    const res = await resend.emails.receiving.attachments.list({ emailId });
    if (res.error) throw new Error(res.error.message);
    for (const [i, a] of res.data.data.entries()) {
      const name = a.filename || listed[i]?.filename || `attachment-${i + 1}`;
      const at: MailAttachment = { name, type: a.content_type, size: a.size, path: '' };
      if (a.size <= ATTACHMENT_MAX) {
        try {
          const r = await fetch(a.download_url);
          if (!r.ok) throw new Error(`download ${r.status}`);
          const path = `mail/${docId}/${i + 1}-${safeName(name)}`;
          await saveFile(path, Buffer.from(await r.arrayBuffer()), a.content_type || 'application/octet-stream');
          at.path = path;
        } catch (e) { logger.warn('[mail] attachment copy failed', docId, name, e); }
      }
      out[i] = at;
    }
  } catch (e) {
    logger.warn('[mail] could not list attachments', docId, e);
  }
  return out;
}

async function findThreadByResendId(resendThreadId: string): Promise<MailThread | null> {
  const direct = await db().doc(`${THR}/${resendThreadId}`).get();
  if (direct.exists) return threadOf(direct);
  const q = await db().collection(THR).where('resendThreadId', '==', resendThreadId).limit(1).get();
  return q.empty ? null : threadOf(q.docs[0]);
}

interface InboundData { inbox_id: string; thread_id: string; email_id: string; thread?: { folder?: string; subject?: string | null } }

async function handleInbound(data: InboundData) {
  const docId = `in_${data.email_id}`;
  const ref = msgRef(docId);
  if ((await ref.get()).exists) return; // a retried webhook
  const settings = await getSettings();
  const resend = resendFor(settings);
  if (!resend) throw new Error('No Resend API key');
  const m = mailSettingsOf(settings);

  const res = await resend.inboxes.threads.emails.get({ inboxId: data.inbox_id, threadId: data.thread_id, emailId: data.email_id });
  if (res.error) throw new Error(`Could not fetch the e-mail: ${res.error.message}`);
  const e = res.data;
  if (e.direction === 'outbound') return; // our own send, recorded when it was queued

  const sender = parseAddress(e.from);
  const inbox = await inboxAddressById(resend, data.inbox_id, m);
  const at = Date.parse(e.received_at) || Date.now();
  let html = e.html ?? undefined;
  let htmlPath: string | undefined;
  if (html && html.length > INLINE_HTML_MAX) {
    htmlPath = `mail/${docId}/body.html`;
    await saveFile(htmlPath, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
    html = undefined;
  }
  const text = (e.text?.trim() ? e.text : htmlToText(e.html ?? '')).slice(0, TEXT_MAX);
  const attachments = await copyAttachments(resend, data.email_id, docId, e.attachments ?? []);

  // Spam: our block list, or Resend's own filter.
  const blocked = isBlocked(sender.email, m.blockedSenders);
  const resendSpam = data.thread?.folder === 'spam';
  const spamReason = blocked ? 'The sender is on the block list.' : resendSpam ? "Resend's spam filter put it in spam." : undefined;
  const flags = [...(blocked ? ['blocked-sender'] : []), ...(resendSpam ? ['resend-spam'] : [])];

  // The thread: Resend's thread, else one of ours that has no Resend thread yet (a new message or a
  // contact-form reply that went out moments ago), else a new one.
  let thread = await findThreadByResendId(data.thread_id);
  if (!thread) {
    const q = await db().collection(THR).where('counterpart', '==', sender.email).orderBy('lastAt', 'desc').limit(10).get();
    const subj = normalizeSubject(e.subject ?? '');
    const adopt = q.docs.map(threadOf).find((t) => !t.resendThreadId && (t.inbox ?? adminAddress(m)) === inbox && normalizeSubject(t.subject) === subj);
    if (adopt) thread = adopt;
  }
  const threadRef = thread ? db().doc(`${THR}/${thread.id}`) : db().doc(`${THR}/${data.thread_id}`);

  const msg: Omit<MailMessage, 'id'> = {
    threadId: threadRef.id, direction: 'in', status: 'received', source: 'inbound', via: 'inbox', priority: 0,
    from: sender.email, fromName: sender.name || undefined, to: e.to ?? [], cc: e.cc ?? [], counterpart: sender.email,
    subject: (e.subject ?? '').slice(0, 500) || '(no subject)', text, html, htmlPath, attachments,
    messageId: e.message_id ?? undefined, resendId: data.email_id, resendThreadId: data.thread_id, flags, at, ...inboxField(inbox, m),
  };

  // Automated or broadcast messages to this person with the same subject join the new thread.
  const linked: string[] = [];
  if (!thread) {
    const earlier = await db().collection(MSG).where('counterpart', '==', sender.email).where('direction', '==', 'out').orderBy('at', 'desc').limit(10).get();
    const subj = normalizeSubject(msg.subject);
    for (const d of earlier.docs) {
      const x = msgOf(d);
      if (!x.threadId && (x.inbox ?? adminAddress(m)) === inbox && normalizeSubject(x.subject) === subj) linked.push(d.id);
    }
  }

  const [dayRef, monthRef] = quotaRefs(at);
  const b = db().batch();
  b.set(ref, clean(msg));
  for (const id of linked) b.update(msgRef(id), { threadId: threadRef.id });
  const snippet = snippetOf(text);
  const fromLabel = sender.name || sender.email;
  if (thread) {
    // New mail brings an archived thread back to the Inbox; spam stays spam.
    const folder = spamReason ? 'spam' : thread.folder === 'spam' ? 'spam' : 'inbox';
    b.update(threadRef, clean({
      folder, unread: true, lastAt: Math.max(thread.lastAt, at), lastSnippet: snippet, lastFrom: fromLabel, messageCount: FieldValue.increment(1),
      resendThreadId: data.thread_id, counterpartName: thread.counterpartName || sender.name || undefined,
      ...(flags.length ? { flags: FieldValue.arrayUnion(...flags) } : {}), ...(spamReason ? { spamReason } : {}),
    }));
  } else {
    const t: Omit<MailThread, 'id'> = {
      subject: msg.subject, counterpart: sender.email, counterpartName: sender.name || undefined, folder: spamReason ? 'spam' : 'inbox', flags, spamReason,
      unread: true, resendThreadId: data.thread_id, lastAt: at, lastSnippet: snippet, lastFrom: fromLabel, messageCount: 1 + linked.length, createdAt: at,
      ...inboxField(inbox, m),
    };
    b.set(threadRef, clean(t));
  }
  b.set(dayRef, { received: FieldValue.increment(1) }, { merge: true });
  b.set(monthRef, { received: FieldValue.increment(1) }, { merge: true });
  await b.commit();
}

/** Delivery events for e-mails we sent. */
async function handleDelivery(type: string, data: Record<string, unknown>) {
  const id = String(data.email_id ?? '');
  if (!id) return;
  const q = await db().collection(MSG).where('resendId', '==', id).limit(1).get();
  if (q.empty) return; // not one of ours, or the send is still being recorded
  const msg = msgOf(q.docs[0]);
  const ref = q.docs[0].ref;
  const bad = (status: 'bounced' | 'complained' | 'failed', flag: string, error: string) => Promise.all([
    ref.update({ status, error, flags: FieldValue.arrayUnion(flag) }),
    msg.threadId ? db().doc(`${THR}/${msg.threadId}`).update({ flags: FieldValue.arrayUnion(flag) }).catch(() => undefined) : null,
    msg.orderId ? updateOrderEmail(msg.orderId, msg.id, { ok: false, error }) : null,
  ]);
  const detail = (k: string, f: string) => String((data[k] as Record<string, unknown> | undefined)?.[f] ?? '');
  switch (type) {
    case 'email.sent':
      if (msg.status === 'queued' || msg.status === 'sending') await ref.update({ status: 'sent' });
      break;
    case 'email.delivered':
      if (!['bounced', 'complained', 'failed'].includes(msg.status)) await ref.update({ status: 'delivered', deliveredAt: Date.now() });
      break;
    case 'email.delivery_delayed':
      await ref.update({ flags: FieldValue.arrayUnion('delayed') });
      if (msg.threadId) await db().doc(`${THR}/${msg.threadId}`).update({ flags: FieldValue.arrayUnion('delayed') }).catch(() => undefined);
      break;
    case 'email.bounced':
      await bad('bounced', 'bounced', `Bounced${detail('bounce', 'message') ? `: ${detail('bounce', 'message')}` : ''}`);
      break;
    case 'email.complained':
      await bad('complained', 'complained', 'The recipient marked it as spam.');
      break;
    case 'email.failed':
      await bad('failed', 'send-failed', `Failed${detail('failed', 'reason') ? `: ${detail('failed', 'reason')}` : ''}`);
      break;
    case 'email.suppressed':
      await bad('failed', 'send-failed', `Resend did not send it: the address is on its suppression list${detail('suppressed', 'message') ? ` (${detail('suppressed', 'message')})` : ''}.`);
      break;
  }
}

/** Our new message or contact reply started a Resend thread: remember it, so replies join ours. */
async function handleInboxSent(data: { thread_id?: string; email_id?: string }) {
  if (!data.thread_id || !data.email_id) return;
  const q = await db().collection(MSG).where('resendId', '==', data.email_id).limit(1).get();
  if (q.empty) return;
  const msg = msgOf(q.docs[0]);
  if (!msg.resendThreadId) await q.docs[0].ref.update({ resendThreadId: data.thread_id });
  if (msg.threadId) {
    const t = db().doc(`${THR}/${msg.threadId}`);
    await db().runTransaction(async (tx) => {
      const s = await tx.get(t);
      if (s.exists && !s.data()?.resendThreadId) tx.update(t, { resendThreadId: data.thread_id });
    });
  }
}

async function handleFolderUpdated(data: { thread_id?: string; to?: string; source?: string }) {
  if (!data.thread_id || data.to !== 'spam' || data.source === 'api') return;
  const t = await findThreadByResendId(data.thread_id);
  if (!t || t.folder === 'spam') return;
  await db().doc(`${THR}/${t.id}`).update({ folder: 'spam', spamReason: 'Moved to spam in Resend.', flags: FieldValue.arrayUnion('resend-spam') });
}

export const mailWebhook = onRequest({ cors: false, timeoutSeconds: 120, memory: '512MiB' }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) { logger.error('[mail] RESEND_WEBHOOK_SECRET is not set'); res.status(500).send('not configured'); return; }
  let event: { type: string; data: Record<string, unknown> };
  try {
    event = new Resend(process.env.RESEND_API_KEY || 're_unused').webhooks.verify({
      payload: req.rawBody.toString('utf8'),
      headers: { id: req.header('svix-id') ?? '', timestamp: req.header('svix-timestamp') ?? '', signature: req.header('svix-signature') ?? '' },
      webhookSecret: secret,
    }) as unknown as { type: string; data: Record<string, unknown> };
  } catch (e) {
    logger.warn('[mail] webhook signature rejected', errText(e));
    res.status(400).send('bad signature');
    return;
  }
  try {
    if (event.type === 'inbox.email.received') await handleInbound(event.data as unknown as InboundData);
    else if (event.type === 'inbox.email.sent') await handleInboxSent(event.data);
    else if (event.type === 'inbox.thread.folder_updated') await handleFolderUpdated(event.data);
    else if (event.type.startsWith('email.')) await handleDelivery(event.type, event.data);
    res.status(200).send('ok');
  } catch (e) {
    // A 5xx makes Resend retry later.
    logger.error('[mail] webhook', event.type, e);
    res.status(500).send('error');
  }
});

// ---------------------------------------------------------------------------------------------
// Contact form
// ---------------------------------------------------------------------------------------------

export const contactOnCreate = onDocumentCreated({ document: 'contactSubmissions/{id}', region: TRIGGER_REGION }, async (ev) => {
  const c = ev.data?.data() as Omit<ContactSubmission, 'id'> | undefined;
  if (!c || c.status !== 'new') return;
  const id = ev.params.id;
  const m = mailSettingsOf(await getSettings());
  const email = c.email.trim().toLowerCase();
  const blocked = isBlocked(email, m.blockedSenders);
  const now = Date.now();
  const subject = c.subject.trim().slice(0, CONTACT_LIMITS.subject) || '(no subject)';
  const text = `${c.message.trim()}${c.orderRef?.trim() ? `\n\nOrder number: ${c.orderRef.trim()}` : ''}`;
  const threadRef = db().doc(`${THR}/c_${id}`);
  const msg: Omit<MailMessage, 'id'> = {
    threadId: threadRef.id, direction: 'in', status: 'received', source: 'contact', via: 'inbox', priority: 0,
    from: email, fromName: c.name.trim(), to: [adminAddress(m)], counterpart: email, subject, text, html: textToHtml(text), attachments: [], at: now,
  };
  const t: Omit<MailThread, 'id'> = {
    subject, counterpart: email, counterpartName: c.name.trim(), folder: blocked ? 'spam' : 'inbox', flags: blocked ? ['blocked-sender'] : [],
    ...(blocked ? { spamReason: 'The sender is on the block list.' } : {}),
    unread: true, contactId: id, lastAt: now, lastSnippet: snippetOf(text), lastFrom: c.name.trim() || email, messageCount: 1, createdAt: now,
  };
  const b = db().batch();
  b.set(threadRef, clean(t));
  b.set(msgRef(`ct_${id}`), clean(msg));
  b.update(ev.data!.ref, { status: blocked ? 'spam' : 'filed', threadId: threadRef.id });
  await b.commit();
  await logActivity('create', 'email', `Contact form message from ${email}`, { entityId: threadRef.id, entityName: subject });
});
