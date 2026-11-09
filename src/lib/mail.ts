// Shared inbox and send queue: addresses, quota arithmetic and text helpers. Pure, shared by the
// Cloud Functions (functions/src/mail.ts) and the staff app. Imports values by relative path only.
import type { MailQuota, MailSettings, MailSource, Settings } from '../types';

export const MAIL_DEFAULTS: MailSettings = {
  domain: 'tsuchinoco.xyz',
  adminLocalPart: 'admin',
  automatedLocalPart: 'orders',
  fromName: 'Tsuchinoco',
  // Resend free plan. Received mail counts toward both.
  dailyLimit: 100,
  monthlyLimit: 3000,
  blockedSenders: [],
};

export function mailSettingsOf(s: Pick<Settings, 'mail' | 'resendFromName'>): MailSettings {
  const m = { ...MAIL_DEFAULTS, ...(s.resendFromName ? { fromName: s.resendFromName } : {}), ...(s.mail ?? {}) };
  return { ...m, blockedSenders: m.blockedSenders ?? [] };
}

export const adminAddress = (m: Pick<MailSettings, 'adminLocalPart' | 'domain'>) => `${m.adminLocalPart}@${m.domain}`;
/** The inbox a thread or message belongs to; mail from before inboxes were recorded is the shared one. */
export const inboxOf = (x: { inbox?: string }, m: Pick<MailSettings, 'adminLocalPart' | 'domain'>) => x.inbox ?? adminAddress(m);

export const automatedAddress = (m: Pick<MailSettings, 'automatedLocalPart' | 'domain'>) => `${m.automatedLocalPart}@${m.domain}`;

/** `Name <a@b.c>`, with characters that would break the header removed from the name. */
export const formatFrom = (name: string | undefined, address: string) => {
  const n = (name ?? '').replace(/[<>"\r\n]/g, '').trim();
  return n ? `${n} <${address}>` : address;
};

export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** `Name <a@b.c>` or `a@b.c` → parts; the address is lower-cased. */
export function parseAddress(raw: string): { name: string; email: string } {
  const s = (raw ?? '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: s.toLowerCase() };
}

/** Addresses typed into To or Cc: separated by commas, semicolons, spaces or new lines. */
export function splitAddresses(raw: string): { ok: string[]; bad: string[] } {
  const parts = (raw ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const ok: string[] = [];
  const bad: string[] = [];
  for (const p of parts) {
    const e = parseAddress(p).email;
    if (EMAIL_RE.test(e)) { if (!ok.includes(e)) ok.push(e); } else bad.push(p);
  }
  return { ok, bad };
}

/** Subject without any number of leading Re:/Fwd: prefixes. */
export const normalizeSubject = (s: string) => (s ?? '').replace(/^\s*((re|fw|fwd|aw|balas)\s*(\[\d+\])?\s*:\s*)+/i, '').trim();
export const replySubject = (s: string) => `Re: ${normalizeSubject(s) || '(no subject)'}`;

/** Block-list entries are full addresses or whole domains written `@example.com` (or `example.com`). */
export function isBlocked(email: string, list: string[]): boolean {
  const e = (email ?? '').toLowerCase();
  const domain = e.split('@')[1] ?? '';
  return list.some((raw) => {
    const x = raw.trim().toLowerCase();
    if (!x) return false;
    if (x.includes('@') && !x.startsWith('@')) return x === e;
    return domain === x.replace(/^@/, '');
  });
}

// ---- Quota (Resend counts per UTC day and month) ----

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
export const monthKey = (now: number) => `m-${new Date(now).toISOString().slice(0, 7)}`;
export function nextDayReset(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
export function nextMonthReset(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

const used = (q?: MailQuota) => (q?.sent ?? 0) + (q?.received ?? 0);

/** E-mails that can still go out now, given today's and this month's counters. */
export function budgetLeft(day: MailQuota | undefined, month: MailQuota | undefined, m: Pick<MailSettings, 'dailyLimit' | 'monthlyLimit'>, now: number): number {
  if ((day?.blockedUntil ?? 0) > now || (month?.blockedUntil ?? 0) > now) return 0;
  return Math.max(0, Math.min(m.dailyLimit - used(day), m.monthlyLimit - used(month)));
}

/** How a send of `count` e-mails spreads over the coming days. Ignores mail received meanwhile. */
export function sendPlan(count: number, budgetNow: number, m: Pick<MailSettings, 'dailyLimit'>, now: number): { today: number; later: number; days: number; resetAt: number } {
  const today = Math.min(count, budgetNow);
  const later = count - today;
  return { today, later, days: later > 0 ? Math.ceil(later / Math.max(1, m.dailyLimit)) : 0, resetAt: nextDayReset(now) };
}

export const PRIORITY: Record<Extract<MailSource, 'staff' | 'order' | 'broadcast'>, number> = { staff: 0, order: 1, broadcast: 2 };

// ---- Text ----

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text → simple HTML: blank lines make paragraphs, single new lines make breaks, links become links. */
export function textToHtml(text: string): string {
  const link = (s: string) => s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}">${u}</a>`);
  return (text ?? '').trim().split(/\n{2,}/).map((p) => `<p>${link(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`).join('\n');
}

/** Rough HTML → text, for snippets, the text part of a send and search. */
export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const snippetOf = (text: string, n = 140) => {
  const one = (text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** {{name}}-style placeholders. Unknown ones are left alone. */
export function personalize(s: string, vars: Record<string, string>): string {
  return s.replace(/{{\s*(\w+)\s*}}/g, (all, k: string) => (k in vars ? vars[k] ?? '' : all));
}

/** A staff message: body, signature, and the earlier message quoted underneath. */
export function composeMessage(o: { body: string; signature?: string; quote?: { from: string; at: number; text: string } }): { text: string; html: string } {
  const sig = (o.signature ?? '').trim();
  const parts = [o.body.trim(), ...(sig ? [sig] : [])];
  let text = parts.join('\n\n');
  let html = parts.map(textToHtml).join('\n');
  if (o.quote && o.quote.text.trim()) {
    const when = new Date(o.quote.at).toUTCString().replace(' GMT', ' UTC');
    const head = `On ${when}, ${o.quote.from} wrote:`;
    const q = o.quote.text.trim().slice(0, 20000);
    text += `\n\n${head}\n${q.split('\n').map((l) => `> ${l}`).join('\n')}`;
    html += `\n<p style="color:#666">${escapeHtml(head)}</p>\n<blockquote style="margin:0 0 0 8px;padding-left:10px;border-left:3px solid #ddd;color:#555">${textToHtml(q)}</blockquote>`;
  }
  return { text, html };
}

/** Reply-box entries younger than this count as "is replying". */
export const REPLYING_TTL = 10 * 60 * 1000;

/** Files staff attach to one message: Resend's inbox API takes up to 10 files and 25 MB. */
export const ATTACHMENT_LIMITS = { files: 10, totalBytes: 20 * 1024 * 1024 } as const;
/** Where the browser uploads files before they are attached; the server only accepts paths here. */
export const OUTGOING_ATTACHMENT_PREFIX = 'mail/out/';

export const CONTACT_LIMITS = { name: 120, email: 160, subject: 200, message: 5000, orderRef: 40 } as const;
