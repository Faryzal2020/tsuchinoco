// Typed wrappers around the Cloud Functions callables.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

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

  // Active email broadcast callable
  sendBroadcastEmail: call<
    {
      recipients: { email: string; name?: string; variables?: Record<string, string> }[];
      subject: string;
      html: string;
      from: string;
      replyTo?: string;
      apiKey?: string;
    },
    {
      ok: true;
      total: number;
      sentCount: number;
      failedCount: number;
      results: { email: string; success: boolean; id?: string; error?: string }[];
    }
  >('sendBroadcastEmail'),
};
