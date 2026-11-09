'use client';

// The shared inbox: one conversation list for admin@ that every staff member sees, the send
// queue's Outbox, Sent and Failed views, and replies that go out through the queue.
// Data comes from useMail(), so the sandbox can render it on sample data.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useQuery } from '@/lib/useQuery';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Confirm, Modal } from '@/components/ui/Dialog';
import { Pill, StatusPill } from '@/components/ui/Bits';
import { cn } from '@/lib/utils';
import { formatDateTime, formatMoney } from '@/lib/format';
import { adminAddress, ATTACHMENT_LIMITS, budgetLeft, inboxOf, mailSettingsOf, REPLYING_TTL } from '@/lib/mail';
import type { MailAttachment, MailFolder, MailMessage, MailThread, Order } from '@/types';
import { useMail } from './MailContext';

type View = MailFolder | 'outbox' | 'sent' | 'failed';
const VIEWS: { id: View; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'outbox', label: 'Outbox' },
  { id: 'sent', label: 'Sent' },
  { id: 'failed', label: 'Failed' },
  { id: 'spam', label: 'Spam' },
  { id: 'archive', label: 'Archive' },
];
const FAILED = ['failed', 'bounced', 'complained'];

const SOURCE_LABEL: Record<string, string> = { staff: 'Staff', order: 'Order update', broadcast: 'Broadcast', inbound: 'E-mail', contact: 'Contact form' };
const STATUS_TONE: Record<string, 'neutral' | 'blue' | 'yellow' | 'green' | 'red'> = {
  queued: 'yellow', sending: 'yellow', sent: 'blue', delivered: 'green', failed: 'red', bounced: 'red', complained: 'red', received: 'neutral',
};
const STATUS_TEXT: Record<string, string> = {
  queued: 'Waiting', sending: 'Sending', sent: 'Sent', delivered: 'Delivered', failed: 'Failed', bounced: 'Bounced', complained: 'Marked as spam', received: 'Received',
};
const FLAG_TEXT: Record<string, { label: string; tone: 'red' | 'yellow' }> = {
  'send-failed': { label: 'Send failed', tone: 'red' },
  bounced: { label: 'Bounced', tone: 'red' },
  complained: { label: 'Marked as spam by recipient', tone: 'red' },
  delayed: { label: 'Delivery delayed', tone: 'yellow' },
};

const shortTime = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * On desktop the Inbox fills the window below its own top edge, so each column scrolls on its own
 * and the folders and page header stay put. On narrower screens the page scrolls as usual.
 */
function useFillHeight(bottomGap = 24) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const measure = () => {
      const el = ref.current;
      if (!el || !wide.matches) { setHeight(null); return; }
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(420, Math.floor(window.innerHeight - top - bottomGap)));
    };
    measure();
    const late = setTimeout(measure, 300); // after fonts settle the header height
    window.addEventListener('resize', measure);
    wide.addEventListener('change', measure);
    return () => { clearTimeout(late); window.removeEventListener('resize', measure); wide.removeEventListener('change', measure); };
  }, [bottomGap]);
  return { ref, style: height ? { height } : undefined };
}

/** `inbox`: the address whose mail to show, one of useMail().inboxes. */
export default function Inbox({ inbox }: { inbox: string }) {
  const mail = useMail();
  const { settings, staffName } = useData();
  const { me } = useAuth();
  const { get, set } = useQuery();
  const view = (VIEWS.some((v) => v.id === get('folder')) ? get('folder') : 'inbox') as View;
  const threadId = get('thread') || null;
  const messageId = get('message') || null;
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const m = mailSettingsOf(settings);
  const fill = useFillHeight();

  // Only this inbox's mail. Mail recorded before inboxes existed belongs to the shared one.
  const threads = useMemo(() => mail.threads.filter((t) => inboxOf(t, m) === inbox), [mail.threads, inbox, m.adminLocalPart, m.domain]); // eslint-disable-line react-hooks/exhaustive-deps
  const outgoing = useMemo(() => mail.outgoing.filter((x) => inboxOf(x, m) === inbox), [mail.outgoing, inbox, m.adminLocalPart, m.domain]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    inbox: threads.filter((t) => t.folder === 'inbox' && t.unread).length,
    spam: threads.filter((t) => t.folder === 'spam' && t.unread).length,
    outbox: outgoing.filter((x) => x.status === 'queued' || x.status === 'sending').length,
    failed: outgoing.filter((x) => FAILED.includes(x.status)).length,
  }), [threads, outgoing]);

  const q = search.trim().toLowerCase();
  const threadRows = useMemo(() => {
    if (view === 'outbox' || view === 'sent' || view === 'failed') return [];
    return threads.filter((t) => t.folder === view && (!q || [t.counterpart, t.counterpartName, t.subject, t.lastSnippet].some((s) => s?.toLowerCase().includes(q))));
  }, [threads, view, q]);
  const messageRows = useMemo(() => {
    const want = view === 'outbox' ? ['queued', 'sending'] : view === 'sent' ? ['sent', 'delivered'] : view === 'failed' ? FAILED : null;
    if (!want) return [];
    const list = outgoing.filter((x) => want.includes(x.status) && (!q || [x.counterpart, x.subject, ...x.to].some((s) => s?.toLowerCase().includes(q))));
    // The Outbox shows the order they will go in.
    return view === 'outbox' ? [...list].sort((a, b) => a.priority - b.priority || (a.queuedAt ?? 0) - (b.queuedAt ?? 0)) : list;
  }, [outgoing, view, q]);

  // Only the newest mail is loaded; the Outbox is always complete.
  const moreKind = view === 'outbox' ? null
    : view === 'sent' || view === 'failed' ? (mail.hasMore.outgoing ? 'outgoing' as const : null)
    : mail.hasMore.threads ? 'threads' as const : null;

  const thread = threadId ? threads.find((t) => t.id === threadId) ?? null : null;
  const message = messageId ? outgoing.find((x) => x.id === messageId) ?? null : null;
  const open = (patch: Record<string, string | null>) => set(patch, false);
  const hasDetail = !!(thread || message);

  // Opening a thread marks it read.
  useEffect(() => {
    if (thread?.unread) mail.setUnread([thread.id], false).catch(() => undefined);
  }, [thread?.id, thread?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const budget = budgetLeft(mail.quotaDay, mail.quotaMonth, m, Date.now());
  const usedToday = (mail.quotaDay?.sent ?? 0) + (mail.quotaDay?.received ?? 0);
  const blockedUntil = Math.max(mail.quotaDay?.blockedUntil ?? 0, mail.quotaMonth?.blockedUntil ?? 0);

  return (
    <div ref={fill.ref} style={fill.style} className="grid gap-3 items-start lg:items-stretch lg:grid-cols-[156px_minmax(250px,300px)_minmax(0,1fr)] 2xl:grid-cols-[176px_340px_minmax(0,1fr)]">
      {/* Folders */}
      <nav className={cn('space-y-3 lg:min-h-0 lg:overflow-y-auto', hasDetail && 'hidden lg:block')} aria-label="Mail folders">
        <Button variant="primary" className="w-full" onClick={() => setComposeOpen(true)}>New message</Button>
        <div className="flex flex-wrap gap-1 lg:flex-col">
          {VIEWS.map((v) => {
            const n = counts[v.id as keyof typeof counts] ?? 0;
            const plus = v.id === 'outbox' && mail.hasMore.waiting ? '+' : '';
            return (
              <button key={v.id} type="button" className="nav-link justify-between lg:w-full" aria-current={view === v.id ? 'page' : undefined} onClick={() => open({ folder: v.id === 'inbox' ? null : v.id, thread: null, message: null })}>
                <span>{v.label}</span>
                {n > 0 && <span className={cn('ml-2 text-xs font-bold', v.id === 'failed' ? 'text-red-ink' : 'text-ink-2')}>{n}{plus}</span>}
              </button>
            );
          })}
        </div>
        <div className="panel px-3 py-2.5 text-sm space-y-0.5" title="Received mail counts too. Waiting mail goes out after the daily reset at 07:00 WIB.">
          <div className="eyebrow">Sending today</div>
          <div><b>{usedToday}</b> of {m.dailyLimit} used</div>
          <div className="hint">{budget} left · {counts.outbox}{mail.hasMore.waiting ? '+' : ''} waiting</div>
          <div className="hint">Month: {(mail.quotaMonth?.sent ?? 0) + (mail.quotaMonth?.received ?? 0)} of {m.monthlyLimit}</div>
          {blockedUntil > Date.now() && <div className="text-red-ink text-xs">Resend paused sending until {formatDateTime(blockedUntil)}.</div>}
          <div className="hint text-xs pt-1">Resets 07:00 WIB.</div>
        </div>
      </nav>

      {/* List */}
      <section className={cn('panel min-w-0 flex-col lg:min-h-0', hasDetail ? 'hidden lg:flex' : 'flex')} aria-label={VIEWS.find((v) => v.id === view)?.label}>
        <div className="border-b border-line p-2.5">
          <Input small type="search" placeholder="Search name, address, subject" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!mail.loaded ? <p className="p-4 hint">Loading…</p> : threadRows.length === 0 && messageRows.length === 0 ? (
          <p className="p-4 hint">{q ? 'Nothing matches.' : view === 'inbox' ? 'No mail yet.' : 'Nothing here.'}</p>
        ) : (
          <ul className="divide-y divide-line lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {threadRows.map((t) => <ThreadRow key={t.id} t={t} on={t.id === threadId} me={me} staffName={staffName} onOpen={() => open({ thread: t.id, message: null })} />)}
            {messageRows.map((x) => (
              <li key={x.id}>
                <button type="button" className={cn('block w-full text-left px-3 py-2.5 hover:bg-cream', x.id === messageId && 'bg-blue-soft')} onClick={() => open(x.threadId ? { thread: x.threadId, message: null } : { message: x.id, thread: null })}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold truncate">{x.to.join(', ')}</span>
                    <span className="hint shrink-0">{shortTime(x.sentAt ?? x.queuedAt ?? x.at)}</span>
                  </div>
                  <div className="truncate text-sm">{x.subject}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Pill tone={STATUS_TONE[x.status]}>{STATUS_TEXT[x.status]}</Pill>
                    <Pill>{SOURCE_LABEL[x.source]}</Pill>
                  </div>
                  {x.error && <div className="mt-1 text-xs text-red-ink line-clamp-2">{x.error}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {mail.loaded && moreKind && (
          <div className="border-t border-line p-2.5 text-center">
            <Button size="sm" variant="quiet" onClick={() => mail.loadMore(moreKind)}>
              {moreKind === 'threads' ? 'Load older conversations' : 'Load older messages'}
            </Button>
          </div>
        )}
      </section>

      {/* Detail */}
      <section className={cn('min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1', !hasDetail && 'hidden lg:block')} aria-label="Message">
        {thread ? (
          <ThreadView key={thread.id} thread={thread} onBack={() => open({ thread: null })} onMoved={() => open({ thread: null })} />
        ) : message ? (
          <div className="space-y-3">
            <div className="lg:hidden"><Button size="sm" variant="quiet" onClick={() => open({ message: null })}>Back</Button></div>
            <MessageCard msg={message} adminLabel={adminAddress(m)} />
          </div>
        ) : (
          <div className="panel px-6 py-16 text-center hint">Choose a conversation.</div>
        )}
      </section>

      <ComposeModal from={inbox} open={composeOpen} onClose={() => setComposeOpen(false)} onSent={(tid) => { setComposeOpen(false); open({ folder: null, thread: tid, message: null }); }} />
    </div>
  );
}

function othersReplying(t: MailThread, me: string): string[] {
  const now = Date.now();
  return Object.entries(t.replying ?? {}).filter(([who, at]) => who !== me && now - at < REPLYING_TTL).map(([who]) => who);
}

function ThreadRow({ t, on, me, staffName, onOpen }: { t: MailThread; on: boolean; me: string; staffName: (id: string) => string; onOpen: () => void }) {
  const replying = othersReplying(t, me);
  const flags = t.flags.filter((f) => FLAG_TEXT[f]);
  return (
    <li>
      <button type="button" className={cn('block w-full text-left px-3 py-2.5 hover:bg-cream', on && 'bg-blue-soft hover:bg-blue-soft')} onClick={onOpen}>
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate', t.unread ? 'font-bold' : 'font-semibold')}>
            {t.unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue align-middle" aria-label="Unread" />}
            {t.counterpartName || t.counterpart}
          </span>
          <span className="hint shrink-0">{shortTime(t.lastAt)}</span>
        </div>
        <div className={cn('truncate text-sm', t.unread && 'font-semibold')}>{t.subject}</div>
        <div className="truncate hint">{t.lastFrom ? `${t.lastFrom}: ` : ''}{t.lastSnippet}</div>
        {(t.contactId || flags.length > 0 || replying.length > 0 || t.messageCount > 1) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {t.messageCount > 1 && <Pill>{t.messageCount} messages</Pill>}
            {t.contactId && <Pill tone="blue">Contact form</Pill>}
            {flags.map((f) => <Pill key={f} tone={FLAG_TEXT[f].tone}>{FLAG_TEXT[f].label}</Pill>)}
            {replying.map((who) => <Pill key={who} tone="yellow">{staffName(who)} is replying</Pill>)}
          </div>
        )}
      </button>
    </li>
  );
}

function ThreadView({ thread, onBack, onMoved }: { thread: MailThread; onBack: () => void; onMoved: () => void }) {
  const mail = useMail();
  const { settings, staffName } = useData();
  const { me } = useAuth();
  const { run } = useToast();
  const { messages, loaded } = mail.useThreadMessages(thread.id);
  const orders = mail.useCustomerOrders(thread.counterpart);
  const [blockOpen, setBlockOpen] = useState(false);
  const m = mailSettingsOf(settings);
  const replying = othersReplying(thread, me);
  const flags = thread.flags.filter((f) => FLAG_TEXT[f]);

  const move = (folder: MailFolder, text: string) => run(async () => { await mail.setFolder([thread.id], folder); onMoved(); }, text);

  return (
    <div className="space-y-3">
      <div className="panel px-4 py-3">
        {/* .btn sets display, so the wrapper hides it on desktop. */}
        <div className="mb-2 lg:hidden"><Button size="sm" variant="quiet" onClick={onBack}>Back</Button></div>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-snug break-words">{thread.subject}</h2>
            <div className="text-sm text-ink-2 break-all">{thread.counterpartName ? `${thread.counterpartName} · ` : ''}{thread.counterpart}</div>
          </div>
        <div className="flex flex-wrap gap-2">
          {thread.folder !== 'archive' && <Button size="sm" onClick={() => move('archive', 'Archived')}>Archive</Button>}
          {thread.folder !== 'inbox' && <Button size="sm" onClick={() => move('inbox', 'Moved to the Inbox')}>{thread.folder === 'spam' ? 'Not spam' : 'Move to Inbox'}</Button>}
          {thread.folder !== 'spam' && <Button size="sm" onClick={() => move('spam', 'Moved to Spam')}>Spam</Button>}
          <Button size="sm" onClick={() => run(async () => { await mail.setUnread([thread.id], true); onBack(); }, 'Marked unread')}>Mark unread</Button>
          {!m.blockedSenders.includes(thread.counterpart) && <Button size="sm" variant="quiet" onClick={() => setBlockOpen(true)}>Block sender</Button>}
        </div>
        </div>
        {thread.folder === 'spam' && <p className="mt-3 rounded-lg bg-yellow-soft px-3 py-2 text-sm text-yellow-ink">In Spam: {thread.spamReason || 'marked as spam.'}</p>}
        {flags.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{flags.map((f) => <Pill key={f} tone={FLAG_TEXT[f].tone}>{FLAG_TEXT[f].label}</Pill>)}</div>}
        <OrdersStrip email={thread.counterpart} orders={orders} />
      </div>

      {!loaded ? <p className="hint">Loading…</p> : messages.map((x) => <MessageCard key={x.id} msg={x} adminLabel={adminAddress(m)} staffName={staffName} />)}
      {replying.length > 0 && <p className="rounded-lg bg-yellow-soft px-3 py-2 text-sm text-yellow-ink">{replying.map(staffName).join(', ')} {replying.length === 1 ? 'is' : 'are'} writing a reply.</p>}
      <ReplyBox thread={thread} />

      <Confirm
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title="Block this sender?"
        confirmLabel="Block and move to Spam"
        danger
        onConfirm={async () => {
          const ok = await run(async () => { await mail.blockSender(thread.counterpart); await mail.setFolder([thread.id], 'spam'); }, `Blocked ${thread.counterpart}`);
          setBlockOpen(false);
          if (ok) onMoved();
        }}
      >
        Mail from <b>{thread.counterpart}</b> will go straight to Spam from now on. You can remove the address from the block list in Mail settings.
      </Confirm>
    </div>
  );
}

/** The orders placed with this address, in one line under the thread's subject. */
function OrdersStrip({ email, orders }: { email: string; orders: Order[] }) {
  const { settings } = useData();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-sm">
      <span className="eyebrow">Orders</span>
      {orders.length === 0 ? <span className="hint">None placed with this address.</span> : orders.slice(0, 4).map((o) => (
        <span key={o.id} className="inline-flex flex-wrap items-center gap-1.5">
          <b className="font-mono text-xs">{o.transactionId || o.id}</b>
          <StatusPill status={o.status} />
          {o.payment === 'paid' ? <Pill tone="green">Paid</Pill> : <Pill tone="yellow">Unpaid</Pill>}
          <span className="hint">{formatMoney(o.total, settings.currency)}</span>
        </span>
      ))}
      {orders.length > 4 && <span className="hint">and {orders.length - 4} more</span>}
      {orders.length > 0 && <Button size="sm" className="ml-auto" href={`/?view=all&q=${encodeURIComponent(email)}`}>Open in Orders</Button>}
    </div>
  );
}

export function MessageCard({ msg, adminLabel, staffName }: { msg: MailMessage; adminLabel: string; staffName?: (id: string) => string }) {
  const mail = useMail();
  const { error } = useToast();
  const out = msg.direction === 'out';
  const box = msg.inbox ?? adminLabel;
  const who = out
    ? `${(msg.via === 'inbox' && mail.inboxNames[box]) || msg.fromName || 'Tsuchinoco'} (${msg.source === 'order' ? 'automatic' : box})${msg.sentBy && staffName ? ` · by ${staffName(msg.sentBy)}` : ''}`
    : `${msg.fromName ? `${msg.fromName} ` : ''}<${msg.from}>`;
  const openFile = async (path: string) => {
    try { window.open(await mail.fileUrl(path), '_blank', 'noopener'); } catch (e) { error(`Could not open the file: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <article className={cn('panel', out && 'border-blue/30')}>
      <header className={cn('flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5', out ? 'bg-blue-soft/50' : 'bg-cream')}>
        <div className="min-w-0">
          <div className="font-semibold break-all">{who}</div>
          <div className="hint break-all">To {msg.to.join(', ')}{msg.cc?.length ? ` · Cc ${msg.cc.join(', ')}` : ''}{msg.bcc?.length ? ` · Bcc ${msg.bcc.join(', ')}` : ''}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {msg.source === 'contact' && <Pill tone="blue">Contact form</Pill>}
          {out && <Pill>{SOURCE_LABEL[msg.source]}</Pill>}
          {out && <Pill tone={STATUS_TONE[msg.status]}>{STATUS_TEXT[msg.status]}</Pill>}
          <span className="hint">{formatDateTime(msg.sentAt ?? msg.at)}</span>
        </div>
      </header>
      {msg.error && <p className="mx-4 mt-3 rounded-lg bg-red-soft px-3 py-2 text-sm text-red-ink">{msg.error}</p>}
      {msg.status === 'queued' && <p className="mx-4 mt-3 rounded-lg bg-yellow-soft px-3 py-2 text-sm text-yellow-ink">Waiting in the Outbox. It goes out as soon as today&apos;s sending budget allows.</p>}
      <div className="px-4 py-3"><MailBody msg={msg} /></div>
      {msg.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
          {msg.attachments.map((a, i) => a.path
            ? <Button key={i} size="sm" onClick={() => openFile(a.path)}>{a.name} · {fmtSize(a.size)}</Button>
            : <span key={i} className="hint" title="The file could not be copied from Resend">{a.name} (not saved)</span>)}
        </div>
      )}
    </article>
  );
}

const REMOTE_IMG = /<img[^>]+src\s*=\s*["']?\s*(https?:)?\/\//i;

function MailBody({ msg }: { msg: MailMessage }) {
  const mail = useMail();
  const [images, setImages] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  useEffect(() => {
    if (!msg.htmlPath) return;
    mail.fileUrl(msg.htmlPath).then(setSrc).catch(() => setSrc(''));
  }, [msg.htmlPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const srcDoc = useMemo(() => {
    if (!msg.html) return null;
    // No scripts, no remote content unless asked; links open in a new tab.
    const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: cid:${images ? ' https: http:' : ''}`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{margin:0;font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#26241F;word-wrap:break-word}img{max-width:100%;height:auto}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #ddd;color:#555}</style></head><body>${msg.html}</body></html>`;
  }, [msg.html, images]);

  const fit = () => {
    const d = frame.current?.contentDocument;
    if (d?.body) setHeight(Math.min(4000, Math.max(80, d.documentElement.scrollHeight + 4)));
  };

  if (msg.htmlPath) {
    if (src === null) return <p className="hint">Loading the message…</p>;
    if (!src) return <p className="hint">The message body could not be loaded.</p>;
    return <iframe title={msg.subject} src={src} sandbox="allow-popups allow-popups-to-escape-sandbox" className="w-full h-[60vh] rounded border border-line bg-white" />;
  }
  if (!srcDoc) return <div className="whitespace-pre-wrap break-words text-sm">{msg.text || <span className="hint">(empty message)</span>}</div>;
  return (
    <div>
      {!images && REMOTE_IMG.test(msg.html ?? '') && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-2">
          <span>Remote images are hidden.</span>
          <button type="button" className="font-semibold text-blue-ink underline" onClick={() => setImages(true)}>Load images</button>
        </div>
      )}
      {/* allow-same-origin without allow-scripts: nothing in the message runs, but the height can be measured. */}
      <iframe ref={frame} title={msg.subject} srcDoc={srcDoc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" onLoad={fit} style={{ height }} className="w-full border-0 bg-white" />
    </div>
  );
}

interface PendingFile { key: string; name: string; size: number; att?: MailAttachment; error?: string }

/** Files picked for an outgoing message. Each uploads straight away; sending waits for them. */
function useAttachments() {
  const mail = useMail();
  const [items, setItems] = useState<PendingFile[]>([]);
  const patch = (key: string, p: Partial<PendingFile>) => setItems((x) => x.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const add = (files: FileList | null) => {
    for (const f of [...(files ?? [])]) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setItems((x) => [...x, { key, name: f.name, size: f.size }]);
      mail.uploadAttachment(f).then((att) => patch(key, { att })).catch((e) => patch(key, { error: e instanceof Error ? e.message : 'Upload failed' }));
    }
  };
  const remove = (key: string) => {
    const it = items.find((i) => i.key === key);
    if (it?.att) void mail.removeUpload(it.att.path);
    setItems((x) => x.filter((i) => i.key !== key));
  };
  /** Forget the files; with `discard`, also delete the uploads (the message was not sent). */
  const reset = (discard: boolean) => {
    if (discard) items.forEach((i) => { if (i.att) void mail.removeUpload(i.att.path); });
    setItems([]);
  };
  const total = items.reduce((n, i) => n + i.size, 0);
  const problem = items.length > ATTACHMENT_LIMITS.files ? `At most ${ATTACHMENT_LIMITS.files} files.`
    : total > ATTACHMENT_LIMITS.totalBytes ? 'Attachments may total at most 20 MB.'
      : items.some((i) => i.error) ? 'Remove the files that could not be uploaded.' : '';
  return { items, add, remove, reset, problem, uploading: items.some((i) => !i.att && !i.error), ready: items.flatMap((i) => (i.att ? [i.att] : [])) };
}

function AttachmentBar({ files }: { files: ReturnType<typeof useAttachments> }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => input.current?.click()}>Attach files</Button>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => { files.add(e.target.files); e.target.value = ''; }} />
        <span className="hint">Up to {ATTACHMENT_LIMITS.files} files, 20 MB in all.</span>
      </div>
      {files.items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.items.map((i) => (
            <li key={i.key} className={cn('inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-sm', i.error ? 'border-red/40 bg-red-soft' : 'border-line bg-cream')}>
              <span className="max-w-[220px] truncate" title={i.name}>{i.name}</span>
              <span className={cn('text-xs', i.error ? 'text-red-ink' : 'text-ink-2')}>{i.error ? 'Upload failed' : i.att ? fmtSize(i.size) : 'Uploading…'}</span>
              <button type="button" className="font-semibold text-ink-2 hover:text-red-ink" onClick={() => files.remove(i.key)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {files.problem && <p className="text-sm text-red-ink">{files.problem}</p>}
    </div>
  );
}

function ReplyBox({ thread }: { thread: MailThread }) {
  const mail = useMail();
  const { state, me } = useAuth();
  const { staffName } = useData();
  const { run } = useToast();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const files = useAttachments();
  const [sending, setSending] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const openedAt = useRef<{ lastAt: number; count: number } | null>(null);
  const signature = state.phase === 'ready' ? state.staff.mailSignature ?? '' : '';

  // Tell the others while the reply box is open; clear it on close.
  useEffect(() => {
    if (!open) return;
    mail.setReplying(thread.id, true).catch(() => undefined);
    const keep = setInterval(() => mail.setReplying(thread.id, true).catch(() => undefined), REPLYING_TTL / 2);
    return () => { clearInterval(keep); mail.setReplying(thread.id, false).catch(() => undefined); };
  }, [open, thread.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => { openedAt.current = { lastAt: thread.lastAt, count: thread.messageCount }; setOpen(true); };
  const close = (sent = false) => { setOpen(false); setBody(''); setCc(''); setBcc(''); setWarn(null); files.reset(!sent); };

  const send = async () => {
    setSending(true);
    const ok = await run(async () => { await mail.send({ threadId: thread.id, body, cc, bcc, attachments: files.ready }); }, 'Reply queued');
    setSending(false);
    setWarn(null);
    if (ok) close(true);
  };
  const trySend = () => {
    const o = openedAt.current;
    const others = othersReplying(thread, me);
    const changed = o && (thread.lastAt > o.lastAt || thread.messageCount > o.count);
    if (changed || others.length > 0) {
      setWarn([
        changed ? 'A new message arrived in this conversation after you started your reply.' : '',
        others.length ? `${others.map(staffName).join(', ')} ${others.length === 1 ? 'is' : 'are'} also replying.` : '',
      ].filter(Boolean).join(' '));
      return;
    }
    void send();
  };

  if (!open) return <div className="flex justify-end"><Button variant="primary" onClick={start}>Reply</Button></div>;
  return (
    <div className="panel panel-pad space-y-3">
      <div className="text-sm text-ink-2">Reply to <b className="text-ink">{thread.counterpart}</b> from <b className="text-ink">{mail.inboxNames[thread.inbox ?? ''] || thread.inbox || mail.inboxNames[mail.inboxes[0]] || 'the shared address'}</b></div>
      <Textarea rows={7} autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your reply" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cc (optional)"><Input small value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@example.com" /></Field>
        <Field label="Bcc (optional)"><Input small value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Hidden from the other recipients" /></Field>
      </div>
      <AttachmentBar files={files} />
      <p className="hint">{signature ? <>Your signature is added underneath: <span className="whitespace-pre-wrap text-ink-2">{signature}</span></> : 'Set your reply signature in Settings so customers know who answered.'} The earlier message is quoted below it.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => close()}>Cancel</Button>
        <Button variant="primary" onClick={trySend} busy={sending} disabled={!body.trim() || files.uploading || !!files.problem}>{files.uploading ? 'Uploading files…' : 'Send reply'}</Button>
      </div>
      <Confirm open={!!warn} onClose={() => setWarn(null)} onConfirm={send} title="Send anyway?" confirmLabel="Send anyway" busy={sending}>
        {warn} Read the latest message first if you are unsure.
      </Confirm>
    </div>
  );
}

function ComposeModal({ from, open, onClose, onSent }: { from: string; open: boolean; onClose: () => void; onSent: (threadId: string) => void }) {
  const mail = useMail();
  const { state } = useAuth();
  const { settings } = useData();
  const { run } = useToast();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const files = useAttachments();
  const signature = state.phase === 'ready' ? state.staff.mailSignature ?? '' : '';
  useEffect(() => { if (open) { setTo(''); setCc(''); setBcc(''); setSubject(''); setBody(''); } }, [open]);
  const cancel = () => { files.reset(true); onClose(); };
  const send = async () => {
    setBusy(true);
    let threadId = '';
    const ok = await run(async () => { threadId = (await mail.send({ inbox: from, to, cc, bcc, subject, body, attachments: files.ready })).threadId; }, 'Message queued');
    setBusy(false);
    if (ok) { files.reset(false); onSent(threadId); }
  };
  return (
    <Modal open={open} onClose={cancel} title="New message" wide footer={<><Button onClick={cancel}>Cancel</Button><Button variant="primary" onClick={send} busy={busy} disabled={!to.trim() || !body.trim() || files.uploading || !!files.problem}>{files.uploading ? 'Uploading files…' : 'Send'}</Button></>}>
      <div className="space-y-3">
        <p className="hint">From {mail.inboxNames[from] || mailSettingsOf(settings).fromName} &lt;{from}&gt;</p>
        <Field label="To"><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cc (optional)"><Input value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
          <Field label="Bcc (optional)"><Input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Hidden from the other recipients" /></Field>
        </div>
        <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><Textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <AttachmentBar files={files} />
        <p className="hint">{signature ? 'Your signature is added underneath.' : 'Set your reply signature in Settings.'}</p>
      </div>
    </Modal>
  );
}
