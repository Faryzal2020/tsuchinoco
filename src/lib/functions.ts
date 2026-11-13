// Typed wrappers around the Cloud Functions callables.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { UsageReport } from './usage';
import type { MailInboxInfo, NotificationType, OrderEmail, ShippingQuoteResult } from '@/types';

const call = <Req, Res>(name: string) => async (data: Req): Promise<Res> => {
  const fn = httpsCallable<Req, Res>(functions, name);
  const res = await fn(data);
  return res.data;
};

export const fx = {
  // Legacy JotForm callables (disabled in functions backend)
  generateForm: async (_data: { batchId: string }): Promise<{ formId: string; url: string }> => {
    throw new Error('JotForm functions have been disabled.');
  },
  syncForm: async (_data: { batchId: string }): Promise<{ ok: true; fields: number }> => {
    throw new Error('JotForm functions have been disabled.');
  },
  setFormStatus: async (_data: { batchId: string; enabled: boolean }): Promise<{ ok: true }> => {
    throw new Error('JotForm functions have been disabled.');
  },
  reimportBatch: async (_data: { batchId: string }): Promise<{ imported: number; updated: number; skipped: number }> => {
    throw new Error('JotForm functions have been disabled.');
  },
  jotformStatus: async (): Promise<{ ok: boolean; username?: string; message?: string }> => {
    return { ok: false, message: 'JotForm functions have been disabled.' };
  },

  /** A personalised send from admin@ through the mail queue; `test` sends one copy to the caller. */
  queueBroadcast: call<
    { recipients: { email: string; name?: string; variables?: Record<string, string> }[]; subject: string; html: string; test?: boolean },
    { broadcastId: string; queued: number; sentNow: number; waiting: number; resetAt: number }
  >('queueBroadcast'),

  /** A staff reply in a thread (threadId) or a new message (to, subject) from an inbox, with the caller's signature. */
  queueMail: call<
    { threadId?: string; inbox?: string; to?: string; cc?: string; bcc?: string; subject?: string; body: string; attachments?: { path: string; name: string }[] },
    { id: string; threadId: string }
  >('queueMail'),

  /** The inboxes set up in Resend, the shared admin@ first. An older server returned bare addresses. */
  listMailInboxes: call<Record<string, never>, { inboxes: (MailInboxInfo | string)[] }>('listMailInboxes'),

  /** Rename an inbox in Resend; the name is also the From name on its replies. */
  renameMailInbox: call<{ address: string; name: string }, { address: string; name: string }>('renameMailInbox'),

  usageMetrics: call<Record<string, never>, UsageReport>('usageMetrics'),

  /**
   * Lion Parcel prices for a cart on a published form or storefront lane, shipped to a postcode.
   * Needs a Google sign-in. The returned quoteId goes on the submission; the import charges it.
   */
  quoteShipping: call<{ formId: string; postalCode: string; lines: Record<string, number> }, ShippingQuoteResult>('quoteShipping'),

  /** "Send again" for one order-update e-mail. Records the attempt on the order. */
  resendOrderEmail: call<{ orderId: string; type: NotificationType }, OrderEmail>('resendOrderEmail'),
};
