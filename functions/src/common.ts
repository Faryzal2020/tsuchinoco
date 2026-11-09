// Helpers shared by the function modules.
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { Resend } from 'resend';
import type { Settings, Staff } from '../../src/types';

// Firestore triggers must run in the database's region: the (default) database is in
// asia-southeast2 (Jakarta). The callables in this codebase run in asia-southeast1.
// FIRESTORE_REGION in functions/.env overrides it.
export const TRIGGER_REGION = process.env.FIRESTORE_REGION || 'asia-southeast2';
export const SYSTEM = 'system';

export const db = () => getFirestore();

/** Firestore rejects undefined; strip it recursively. */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as T;
  if (v && typeof v === 'object' && !(v instanceof FieldValue)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = clean(x);
    return out as T;
  }
  return v;
}

export async function logActivity(action: string, entityType: string, details: string, extra: { entityId?: string; entityName?: string; by?: string } = {}) {
  try {
    const { by, ...rest } = extra;
    await db().collection('logs').add(clean({ action, entityType, details, ...rest, createdAt: Date.now(), createdBy: by ?? SYSTEM }));
  } catch (e) {
    logger.warn('[log] could not write', e);
  }
}

export async function getSettings(): Promise<Settings> {
  const s = await db().doc('settings/global').get();
  return (s.exists ? s.data() : {}) as Settings;
}

/** The signed-in caller's staff document; throws unless it is active. */
export async function requireStaff(req: CallableRequest): Promise<Staff> {
  const email = req.auth?.token.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', 'Sign in first.');
  const snap = await db().doc(`staff/${email}`).get();
  if (!snap.exists || snap.data()?.active !== true) throw new HttpsError('permission-denied', 'Not an active staff account.');
  return { id: snap.id, ...(snap.data() as Omit<Staff, 'id'>) };
}

/** The Resend API key from Settings, or RESEND_API_KEY in functions/.env. */
export const resendKey = (settings: Settings) => settings.resendApiKey?.trim() || process.env.RESEND_API_KEY || '';
export const resendFor = (settings: Settings): Resend | null => {
  const key = resendKey(settings);
  return key ? new Resend(key) : null;
};
