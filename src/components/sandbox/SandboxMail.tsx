'use client';

// The shared inbox on sample data for the localhost sandbox: the same Inbox component, with the
// mail queue simulated in memory (queued replies "send" after a moment). Nothing reaches Resend.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fx } from '@/lib/functions';
import { StaticMailProvider, type MailApi, type SendArgs } from '@/components/mail/MailContext';
import { budgetLeft, composeMessage, htmlToText, MAIL_DEFAULTS, nextDayReset, personalize, replySubject, snippetOf, splitAddresses, textToHtml } from '@/lib/mail';
import type { ContactDraft } from '@/components/shop/Shop';
import type { MailMessage, MailQuota, MailThread } from '@/types';
import { useSandbox } from './SandboxProvider';
import { SANDBOX_ME } from './fixtures';

const MIN = 60_000;
const HOUR = 60 * MIN;
const ADMIN = 'admin@tsuchinoco.xyz';
const SUPPORT = 'support@tsuchinoco.xyz';

interface MailState { threads: MailThread[]; messages: MailMessage[]; quotaDay: MailQuota; quotaMonth: MailQuota }

function sample(): MailState {
  const now = Date.now();
  const inMsg = (id: string, threadId: string, from: string, fromName: string, subject: string, body: { text?: string; html?: string }, at: number, extra: Partial<MailMessage> = {}): MailMessage => ({
    id, threadId, direction: 'in', status: 'received', source: 'inbound', via: 'inbox', priority: 0, from, fromName, to: [extra.inbox ?? ADMIN], counterpart: from,
    subject, text: body.text ?? htmlToText(body.html ?? ''), html: body.html ?? (body.text ? textToHtml(body.text) : undefined), attachments: [], at, ...extra,
  });
  const outMsg = (id: string, to: string, subject: string, text: string, at: number, extra: Partial<MailMessage> = {}): MailMessage => ({
    id, direction: 'out', status: 'delivered', source: 'staff', via: 'inbox', priority: 0, from: ADMIN, fromName: 'Tsuchinoco', to: [to], counterpart: to,
    subject, text, html: textToHtml(text), attachments: [], sentBy: SANDBOX_ME, at, sentAt: at, ...extra,
  });
  const messages: MailMessage[] = [
    inMsg('m1', 't1', 'dimas@example.com', 'Dimas Ardi', 'Can someone else pick up my order on Day 2?', {
      text: 'Hi Tsuchinoco,\n\nI ordered CF24_1_0001 for pickup on Day 2 but I might be stuck at work. Can my sister Rina collect it for me? She will bring my confirmation code.\n\nThanks,\nDimas',
    }, now - 25 * MIN),
    inMsg('m2', 't2', 'bayu@example.com', 'Bayu Santoso', 'Question from the shop', {
      text: 'Is the A3 poster printed on matte or glossy paper? I want to frame it.\n\nOrder number: CF24_1_0003',
    }, now - 3 * HOUR, { source: 'contact' }),
    outMsg('m3', 'nadia@example.com', 'Re: Shipping to Bandung', 'Hi Nadia,\n\nYes, we ship to Bandung after the event. Shipping is paid on arrival.\n\n— Sandbox staff', now - 26 * HOUR, { threadId: 't3' }),
    inMsg('m4', 't3', 'nadia@example.com', 'Nadia Putri', 'Re: Shipping to Bandung', {
      html: '<p>Thank you! One more thing: can you send the parcel to my office instead?</p><p><img src="https://placehold.co/320x80/png?text=Office+map" alt="Office map"></p><p>Nadia</p>',
    }, now - 5 * HOUR, { attachments: [{ name: 'office-address.txt', type: 'text/plain', size: 182, path: 'sandbox/office-address.txt' }] }),
    inMsg('m5', 't4', 'winner@prize-claims.example', 'Prize Team', 'You have won a free phone!!!', { text: 'Click here to claim your prize.' }, now - 9 * HOUR, { flags: ['blocked-sender'] }),
    inMsg('m9', 't6', 'kevin@example.com', 'Kevin Susanto', 'Damaged standee', {
      text: 'Hello, my acrylic standee arrived with a crack in the base. Can I get a replacement?\n\nKevin',
    }, now - 50 * MIN, { inbox: SUPPORT }),
    inMsg('m6', 't5', 'sari@example.com', 'Sari Wulandari', 'Thank you!', { text: 'The package arrived safely. The stickers are lovely!' }, now - 6 * 24 * HOUR),
    // The send queue: order updates and a broadcast.
    { ...outMsg('m7', 'kevin@example.com', 'Payment confirmed for MO_1_0001', 'Hi Kevin, your payment is confirmed.', now - 2 * HOUR), source: 'order', via: 'plain', from: 'orders@tsuchinoco.xyz', replyTo: ADMIN, priority: 1, sentBy: undefined, orderId: 'o6', status: 'sent' },
    { ...outMsg('m8', 'agus@example.com', 'We received your order CF23_3_0010', 'Hi Agus, thank you!', now - 30 * HOUR), source: 'order', via: 'plain', from: 'orders@tsuchinoco.xyz', replyTo: ADMIN, priority: 1, sentBy: undefined, status: 'bounced', error: 'Bounced: the mailbox does not exist.', flags: ['bounced'] },
    ...['laras', 'rani', 'sari'].map((n, i) => ({
      ...outMsg(`b${i}`, `${n}@example.com`, '[Comic Frontier 24] Visit our booth!', 'Hi! We are at booth A-12.', now - 10 * MIN), source: 'broadcast' as const, via: 'plain' as const,
      priority: 2, status: 'queued' as const, queuedAt: now - 10 * MIN + i, sentAt: undefined, broadcastId: 'bc1',
    })),
  ];
  const thread = (id: string, t: Partial<MailThread> & Pick<MailThread, 'subject' | 'counterpart'>): MailThread => {
    const own = messages.filter((x) => x.threadId === id);
    const last = own[own.length - 1];
    return {
      id, folder: 'inbox', flags: [], unread: false, lastAt: last.at, lastSnippet: snippetOf(last.text), lastFrom: last.direction === 'out' ? 'Sandbox staff' : last.fromName || last.from,
      messageCount: own.length, createdAt: own[0].at, ...t,
    };
  };
  return {
    threads: [
      thread('t1', { subject: 'Can someone else pick up my order on Day 2?', counterpart: 'dimas@example.com', counterpartName: 'Dimas Ardi', unread: true, replying: { 'rina@example.com': now - 2 * MIN } }),
      thread('t2', { subject: 'Question from the shop', counterpart: 'bayu@example.com', counterpartName: 'Bayu Santoso', unread: true, contactId: 'c1' }),
      thread('t3', { subject: 'Shipping to Bandung', counterpart: 'nadia@example.com', counterpartName: 'Nadia Putri', resendThreadId: 'rt3' }),
      thread('t4', { subject: 'You have won a free phone!!!', counterpart: 'winner@prize-claims.example', counterpartName: 'Prize Team', folder: 'spam', flags: ['blocked-sender'], spamReason: 'The sender is on the block list.' }),
      thread('t6', { subject: 'Damaged standee', counterpart: 'kevin@example.com', counterpartName: 'Kevin Susanto', unread: true, inbox: SUPPORT }),
      thread('t5', { subject: 'Thank you!', counterpart: 'sari@example.com', counterpartName: 'Sari Wulandari', folder: 'archive' }),
    ].sort((a, b) => b.lastAt - a.lastAt),
    messages,
    quotaDay: { sent: 90, received: 8 },
    quotaMonth: { sent: 640, received: 75 },
  };
}

interface SandboxMailCtx { api: MailApi; addContact: (c: ContactDraft) => void }
const Ctx = createContext<SandboxMailCtx | null>(null);
export const useSandboxMail = () => { const c = useContext(Ctx); if (!c) throw new Error('useSandboxMail outside SandboxMailProvider'); return c; };

export function SandboxMailProvider({ children }: { children: React.ReactNode }) {
  const { state: sbx } = useSandbox();
  const [s, setS] = useState<MailState>(sample);
  const [names, setNames] = useState<Record<string, string>>({ [ADMIN]: 'Tsuchinoco', [SUPPORT]: '', 'jknor@tsuchinoco.xyz': '' });
  const ref = useRef(s);
  ref.current = s;
  const ordersRef = useRef(sbx.orders);
  ordersRef.current = sbx.orders;

  const patchThread = useCallback((id: string, fn: (t: MailThread) => MailThread) => setS((x) => ({ ...x, threads: x.threads.map((t) => (t.id === id ? fn(t) : t)) })), []);

  const send = useCallback(async (a: SendArgs) => {
    const now = Date.now();
    const x = ref.current;
    const thread = a.threadId ? x.threads.find((t) => t.id === a.threadId) : undefined;
    const to = thread ? [thread.counterpart] : splitAddresses(a.to ?? '').ok;
    if (!to.length) throw new Error('Add a recipient.');
    const prev = thread ? [...x.messages].reverse().find((m) => m.threadId === thread.id && m.direction === 'in') : undefined;
    const { text, html } = composeMessage({ body: a.body, signature: '— Sandbox staff', quote: prev ? { from: prev.from, at: prev.at, text: prev.text } : undefined });
    const threadId = thread?.id ?? `t${now}`;
    const inbox = thread ? thread.inbox : a.inbox && a.inbox !== ADMIN ? a.inbox : undefined;
    const msg: MailMessage = {
      bcc: splitAddresses(a.bcc ?? '').ok, inbox, id: `m${now}`, threadId, direction: 'out', status: 'queued', source: 'staff', via: 'inbox', priority: 0, from: ADMIN, fromName: 'Tsuchinoco', to, cc: splitAddresses(a.cc ?? '').ok,
      counterpart: to[0], subject: thread ? replySubject(thread.subject) : a.subject?.trim() || '(no subject)', text, html, attachments: a.attachments ?? [], sentBy: SANDBOX_ME, queuedAt: now, at: now,
    };
    setS((y) => ({
      ...y,
      messages: [...y.messages, msg],
      threads: thread
        ? y.threads.map((t) => (t.id === thread.id ? { ...t, lastAt: now, lastSnippet: snippetOf(a.body), lastFrom: 'Sandbox staff', messageCount: t.messageCount + 1, unread: false, replying: Object.fromEntries(Object.entries(t.replying ?? {}).filter(([k]) => k !== SANDBOX_ME)) } : t))
        : [{ id: threadId, inbox, subject: msg.subject, counterpart: to[0], folder: 'inbox', flags: [], unread: false, lastAt: now, lastSnippet: snippetOf(a.body), lastFrom: 'Sandbox staff', messageCount: 1, createdAt: now }, ...y.threads],
    }));
    // The queue "sends" it a moment later, if today's budget allows; otherwise it waits in the Outbox.
    if (budgetLeft(x.quotaDay, x.quotaMonth, MAIL_DEFAULTS, now) <= 0) return { id: msg.id, threadId };
    setTimeout(() => setS((y) => ({ ...y, quotaDay: { ...y.quotaDay, sent: y.quotaDay.sent + 1 }, messages: y.messages.map((m) => (m.id === msg.id ? { ...m, status: 'sent', sentAt: Date.now() } : m)) })), 1500);
    return { id: msg.id, threadId };
  }, []);

  const addContact = useCallback((c: ContactDraft) => {
    const now = Date.now();
    const id = `c${now}`;
    const email = c.email.toLowerCase();
    const text = `${c.message}${c.orderRef ? `\n\nOrder number: ${c.orderRef}` : ''}`;
    const msg: MailMessage = { id: `ct_${id}`, threadId: `c_${id}`, direction: 'in', status: 'received', source: 'contact', via: 'inbox', priority: 0, from: email, fromName: c.name, to: [ADMIN], counterpart: email, subject: c.subject, text, html: textToHtml(text), attachments: [], at: now };
    const t: MailThread = { id: `c_${id}`, subject: c.subject, counterpart: email, counterpartName: c.name, folder: 'inbox', flags: [], unread: true, contactId: id, lastAt: now, lastSnippet: snippetOf(text), lastFrom: c.name, messageCount: 1, createdAt: now };
    setS((y) => ({ ...y, messages: [...y.messages, msg], threads: [t, ...y.threads] }));
  }, []);

  // Broadcasts: queue copies in memory, "sending" what today's budget allows.
  useEffect(() => {
    const saved = fx.queueBroadcast;
    fx.queueBroadcast = async ({ recipients, subject, html, test }) => {
      const now = Date.now();
      const list = test ? [{ email: SANDBOX_ME, name: 'Sandbox staff', variables: recipients[0]?.variables }] : recipients;
      const budget = budgetLeft(ref.current.quotaDay, ref.current.quotaMonth, MAIL_DEFAULTS, now);
      const sentNow = test ? 1 : Math.min(budget, list.length);
      const added: MailMessage[] = list.map((r, i) => {
        const vars = { name: r.name ?? '', email: r.email, ...(r.variables ?? {}) };
        const body = personalize(html, vars);
        return {
          id: `bc${now}_${i}`, direction: 'out', status: i < sentNow ? 'sent' : 'queued', source: test ? 'staff' : 'broadcast', via: 'plain', priority: test ? 0 : 2,
          from: ADMIN, fromName: 'Tsuchinoco', to: [r.email], counterpart: r.email, subject: `${test ? '[TEST] ' : ''}${personalize(subject, vars)}`, html: body, text: htmlToText(body),
          attachments: [], sentBy: SANDBOX_ME, broadcastId: `bc${now}`, queuedAt: now + i, at: now, ...(i < sentNow ? { sentAt: now } : {}),
        };
      });
      setS((y) => ({ ...y, messages: [...y.messages, ...added], quotaDay: { ...y.quotaDay, sent: y.quotaDay.sent + sentNow } }));
      return { broadcastId: `bc${now}`, queued: list.length, sentNow, waiting: list.length - sentNow, resetAt: nextDayReset(now) };
    };
    return () => { fx.queueBroadcast = saved; };
  }, []);

  const api = useMemo<MailApi>(() => ({
    loaded: true,
    inboxes: [ADMIN, 'jknor@tsuchinoco.xyz', SUPPORT],
    inboxNames: names,
    renameInbox: async (address, name) => { setNames((n) => ({ ...n, [address]: name })); },
    uploadAttachment: async (file) => ({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, path: `sandbox/${file.name}` }),
    removeUpload: async () => undefined,
    threads: [...s.threads].sort((a, b) => b.lastAt - a.lastAt),
    outgoing: s.messages.filter((m) => m.direction === 'out').sort((a, b) => b.at - a.at),
    hasMore: { threads: false, outgoing: false },
    loadMore: () => undefined,
    quotaDay: s.quotaDay,
    quotaMonth: s.quotaMonth,
    useThreadMessages: (id) => ({ messages: id ? s.messages.filter((m) => m.threadId === id).sort((a, b) => a.at - b.at) : [], loaded: true }),
    useCustomerOrders: (email) => (email ? ordersRef.current.filter((o) => o.customer.email.toLowerCase() === email) : []),
    setFolder: async (ids, folder) => { ids.forEach((id) => patchThread(id, (t) => ({ ...t, folder, spamReason: folder === 'spam' ? 'Marked as spam by staff.' : undefined }))); },
    setUnread: async (ids, unread) => { ids.forEach((id) => patchThread(id, (t) => ({ ...t, unread }))); },
    setReplying: async (id, on) => {
      patchThread(id, (t) => {
        const r = { ...(t.replying ?? {}) };
        if (on) r[SANDBOX_ME] = Date.now(); else delete r[SANDBOX_ME];
        return { ...t, replying: r };
      });
    },
    blockSender: async () => undefined,
    send,
    fileUrl: async () => `data:text/plain;charset=utf-8,${encodeURIComponent('Sample attachment from the sandbox.\nPT Contoh, Jl. Asia Afrika 8, Bandung 40111')}`,
  }), [s, patchThread, send, names]);

  return <Ctx.Provider value={{ api, addContact }}><StaticMailProvider value={api}>{children}</StaticMailProvider></Ctx.Provider>;
}
