// Typed wrappers around the Cloud Functions callables.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const call = <Req, Res>(name: string) => async (data: Req): Promise<Res> => {
  const fn = httpsCallable<Req, Res>(functions, name);
  const res = await fn(data);
  return res.data;
};

export const fx = {
  generateForm: call<{ batchId: string }, { formId: string; url: string }>('generateForm'),
  syncForm: call<{ batchId: string }, { ok: true; fields: number }>('syncForm'),
  setFormStatus: call<{ batchId: string; enabled: boolean }, { ok: true }>('setFormStatus'),
  reimportBatch: call<{ batchId: string }, { imported: number; updated: number; skipped: number }>('reimportBatch'),
  jotformStatus: call<Record<string, never>, { ok: boolean; username?: string; message?: string }>('jotformStatus'),
};
