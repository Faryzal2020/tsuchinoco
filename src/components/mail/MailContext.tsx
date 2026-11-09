'use client';

// The shared inbox's data and actions behind one interface, so the Inbox renders the same against
// Firestore (FirestoreMailProvider) and against the localhost sandbox's sample data.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  arrayUnion, collection, deleteField, doc, FieldPath, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { COL, logActivity } from '@/lib/repo';
import { fx } from '@/lib/functions';
import { metered, meteredDoc } from '@/lib/readMeter';
import { useData } from '@/lib/data';
import { adminAddress, dayKey, mailSettingsOf, monthKey, OUTGOING_ATTACHMENT_PREFIX } from '@/lib/mail';
import type { MailAttachment, MailFolder, MailMessage, MailQuota, MailThread, Order } from '@/types';

export interface SendArgs { threadId?: string; inbox?: string; to?: string; cc?: string; bcc?: string; subject?: string; body: string; attachments?: MailAttachment[] }

export interface MailApi {
  loaded: boolean;
  /** Inbox addresses to switch between, the shared admin@ first. */
  inboxes: string[];
  /** Address → the name set in Resend ('' when none). */
  inboxNames: Record<string, string>;
  renameInbox: (address: string, name: string) => Promise<void>;
  /** Upload a file to attach to an outgoing message; it is attached when the message is sent. */
  uploadAttachment: (file: File) => Promise<MailAttachment>;
  /** Remove an upload that was taken off a message before sending. */
  removeUpload: (path: string) => Promise<void>;
  /** Newest first, across all folders and inboxes; the latest PAGE, more after loadMore('threads'). */
  threads: MailThread[];
  /** Outgoing messages, newest first: everything waiting to send plus the latest PAGE of the rest. */
  outgoing: MailMessage[];
  /** Whether older threads or sent messages exist beyond what is loaded. */
  hasMore: { threads: boolean; outgoing: boolean };
  /** Load another page of older threads or sent messages. */
  loadMore: (what: 'threads' | 'outgoing') => void;
  quotaDay?: MailQuota;
  quotaMonth?: MailQuota;
  /** Live messages of one thread, oldest first. */
  useThreadMessages: (threadId: string | null) => { messages: MailMessage[]; loaded: boolean };
  /** Orders whose customer e-mail is this address. */
  useCustomerOrders: (email: string | null) => Order[];
  setFolder: (ids: string[], folder: MailFolder) => Promise<void>;
  setUnread: (ids: string[], unread: boolean) => Promise<void>;
  setReplying: (threadId: string, on: boolean) => Promise<void>;
  blockSender: (email: string) => Promise<void>;
  send: (args: SendArgs) => Promise<{ id: string; threadId: string }>;
  /** A link to a stored attachment or message body. */
  fileUrl: (path: string) => Promise<string>;
}

/** Threads and sent messages load in pages of this size; each page is a full re-read, so keep it small. */
export const MAIL_PAGE = 50;

const Ctx = createContext<MailApi | null>(null);

export function useMail(): MailApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMail outside a mail provider');
  return c;
}

/** Fixed implementation, for the localhost sandbox. */
export function StaticMailProvider({ value, children }: { value: MailApi; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const log = (n: string) => (e: Error) => console.error(`[mail] ${n}`, e);
const rows = <T,>(s: { docs: { id: string; data: () => unknown }[] }) => s.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);

function useThreadMessagesFs(threadId: string | null) {
  const [state, setState] = useState<{ id: string | null; messages: MailMessage[]; loaded: boolean }>({ id: null, messages: [], loaded: false });
  useEffect(() => {
    if (!threadId) return;
    return onSnapshot(
      query(collection(db, COL.mailMessages), where('threadId', '==', threadId), orderBy('at', 'asc')),
      metered('mail:thread', (s) => setState({ id: threadId, messages: rows<MailMessage>(s), loaded: true })),
      (e) => { console.error('[mail] thread', e); setState({ id: threadId, messages: [], loaded: true }); },
    );
  }, [threadId]);
  return state.id === threadId ? state : { messages: [], loaded: !threadId };
}

function useCustomerOrdersFs(email: string | null) {
  const [state, setState] = useState<{ email: string | null; orders: Order[] }>({ email: null, orders: [] });
  useEffect(() => {
    if (!email) return;
    return onSnapshot(
      query(collection(db, COL.orders), where('customer.email', '==', email), limit(20)),
      metered('mail:customerOrders', (s) => setState({ email, orders: rows<Order>(s).sort((a, b) => b.submittedAt - a.submittedAt) })),
      (e) => console.error('[mail] customer orders', e),
    );
  }, [email]);
  return state.email === email ? state.orders : [];
}

export function FirestoreMailProvider({ me, children }: { me: string; children: React.ReactNode }) {
  const [threads, setThreads] = useState<MailThread[] | null>(null);
  const [threadLimit, setThreadLimit] = useState(MAIL_PAGE);
  const [outLimit, setOutLimit] = useState(MAIL_PAGE);
  const [recentOut, setRecentOut] = useState<MailMessage[] | null>(null);
  const [pendingOut, setPendingOut] = useState<MailMessage[] | null>(null);
  const [quotaDay, setQuotaDay] = useState<MailQuota>();
  const [quotaMonth, setQuotaMonth] = useState<MailQuota>();
  const { settings } = useData();
  const admin = adminAddress(mailSettingsOf(settings));
  // The inboxes come from Resend; until they load (or if that fails), the shared one and any seen on mail.
  const [listed, setListed] = useState<{ address: string; name: string }[] | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    fx.listMailInboxes({})
      .then((r) => setListed(r.inboxes.map((x) => (typeof x === 'string' ? { address: x, name: '' } : x))))
      .catch((e) => { console.warn('[mail] inboxes', e); setListed([]); });
  }, [reload]);
  // Resend's day is UTC; re-read the counters when it changes.
  const [day, setDay] = useState(() => dayKey(Date.now()));
  useEffect(() => { const t = setInterval(() => setDay(dayKey(Date.now())), 60_000); return () => clearInterval(t); }, []);

  useEffect(() => onSnapshot(
    query(collection(db, COL.mailThreads), orderBy('lastAt', 'desc'), limit(threadLimit)),
    metered('mail:threads', (s) => setThreads(rows<MailThread>(s))),
    (e) => { log('threads')(e); setThreads([]); },
  ), [threadLimit]);
  useEffect(() => onSnapshot(
    query(collection(db, COL.mailMessages), where('direction', '==', 'out'), orderBy('at', 'desc'), limit(outLimit)),
    metered('mail:sent', (s) => setRecentOut(rows<MailMessage>(s))),
    (e) => { log('outgoing')(e); setRecentOut([]); },
  ), [outLimit]);
  // Everything still waiting, however old, so the Outbox and its count stay complete.
  useEffect(() => onSnapshot(
    query(collection(db, COL.mailMessages), where('status', 'in', ['queued', 'sending'])),
    metered('mail:waiting', (s) => setPendingOut(rows<MailMessage>(s).filter((x) => x.direction === 'out'))),
    (e) => { log('waiting')(e); setPendingOut([]); },
  ), []);
  const outgoing = useMemo(() => {
    if (recentOut === null || pendingOut === null) return null;
    const byId = new Map(recentOut.map((x) => [x.id, x]));
    for (const x of pendingOut) if (!byId.has(x.id)) byId.set(x.id, x);
    return [...byId.values()].sort((a, b) => b.at - a.at);
  }, [recentOut, pendingOut]);
  useEffect(() => {
    const now = Date.parse(`${day}T12:00:00Z`);
    const u = [
      onSnapshot(doc(db, COL.mailQuota, dayKey(now)), meteredDoc('mail:quota', (s) => setQuotaDay(s.exists() ? (s.data() as MailQuota) : undefined)), (e) => console.error('[mail] quota', e)),
      onSnapshot(doc(db, COL.mailQuota, monthKey(now)), meteredDoc('mail:quota', (s) => setQuotaMonth(s.exists() ? (s.data() as MailQuota) : undefined)), (e) => console.error('[mail] quota', e)),
    ];
    return () => u.forEach((f) => f());
  }, [day]);

  const inboxes = useMemo(() => {
    const seen = (threads ?? []).map((t) => t.inbox).filter((x): x is string => !!x);
    const rest = [...new Set([...(listed ?? []).map((x) => x.address), ...seen])].filter((a) => a !== admin).sort();
    return [admin, ...rest];
  }, [listed, threads, admin]);
  const inboxNames = useMemo(() => Object.fromEntries((listed ?? []).map((x) => [x.address, x.name])), [listed]);

  const api = useMemo<MailApi>(() => ({
    loaded: threads !== null && outgoing !== null,
    inboxes,
    inboxNames,
    renameInbox: async (address, name) => { await fx.renameMailInbox({ address, name }); setReload((n) => n + 1); },
    uploadAttachment: async (file) => {
      const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
      const path = `${OUTGOING_ATTACHMENT_PREFIX}${crypto.randomUUID()}/${safe}`;
      await uploadBytes(ref(storage, path), file, { contentType: file.type || 'application/octet-stream' });
      return { name: file.name, type: file.type || 'application/octet-stream', size: file.size, path };
    },
    removeUpload: async (path) => { await deleteObject(ref(storage, path)).catch(() => undefined); },
    threads: threads ?? [],
    outgoing: outgoing ?? [],
    hasMore: { threads: (threads?.length ?? 0) >= threadLimit, outgoing: (recentOut?.length ?? 0) >= outLimit },
    loadMore: (what) => (what === 'threads' ? setThreadLimit : setOutLimit)((n) => n + MAIL_PAGE),
    quotaDay,
    quotaMonth,
    useThreadMessages: useThreadMessagesFs,
    useCustomerOrders: useCustomerOrdersFs,
    setFolder: async (ids, folder) => {
      const b = writeBatch(db);
      for (const id of ids) b.update(doc(db, COL.mailThreads, id), folder === 'spam' ? { folder, spamReason: 'Marked as spam by staff.' } : { folder, spamReason: deleteField() });
      await b.commit();
    },
    setUnread: async (ids, unread) => {
      const b = writeBatch(db);
      for (const id of ids) b.update(doc(db, COL.mailThreads, id), { unread });
      await b.commit();
    },
    setReplying: async (threadId, on) => {
      await updateDoc(doc(db, COL.mailThreads, threadId), new FieldPath('replying', me), on ? Date.now() : deleteField());
    },
    blockSender: async (email) => {
      await setDoc(doc(db, COL.settings, 'global'), { mail: { blockedSenders: arrayUnion(email.toLowerCase()) } }, { merge: true });
      await logActivity('update', 'settings', `Blocked e-mail sender ${email}`, me, { entityName: email });
    },
    send: (args) => fx.queueMail(args),
    fileUrl: (path) => getDownloadURL(ref(storage, path)),
  }), [threads, outgoing, recentOut, threadLimit, outLimit, quotaDay, quotaMonth, me, inboxes, inboxNames]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
