import * as fs from 'fs';
import * as path from 'path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { logger } from 'firebase-functions';
import { Resend } from 'resend';

// Load environment variables from .env.local if present (no Cloud Secret Manager needed)
function loadEnvFile(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore read errors
  }
}

// Check local .env files in functions dir or root project dir
loadEnvFile(path.resolve(__dirname, '../.env.local'));
loadEnvFile(path.resolve(__dirname, '../.env'));
loadEnvFile(path.resolve(__dirname, '../../.env.local'));
loadEnvFile(path.resolve(__dirname, '../../.env'));
loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

initializeApp();
const db = getFirestore();

const REGION = 'asia-southeast1';
setGlobalOptions({ region: REGION, maxInstances: 5, invoker: 'public' });

// ---- Helpers ----

async function requireStaff(req: CallableRequest): Promise<string> {
  const email = req.auth?.token.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', 'Sign in first.');
  const snap = await db.collection('staff').doc(email).get();
  if (!snap.exists || snap.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'Not an active staff account.');
  }
  return email;
}

// ---- Email Broadcast ----

export interface BroadcastRecipient {
  email: string;
  name?: string;
  variables?: Record<string, string>;
}

export const sendBroadcastEmail = onCall(
  {
    invoker: 'public',
    cors: true,
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (req) => {
    await requireStaff(req);
    const {
      recipients,
      subject,
      html,
      from,
      replyTo,
      apiKey: customKey,
    } = req.data as {
      recipients: BroadcastRecipient[];
      subject: string;
      html: string;
      from: string;
      replyTo?: string;
      apiKey?: string;
    };

    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new HttpsError('invalid-argument', 'At least one recipient is required.');
    }
    if (!subject?.trim() || !html?.trim() || !from?.trim()) {
      throw new HttpsError('invalid-argument', 'Subject, HTML body, and From address are required.');
    }

    const key = customKey?.trim() || process.env.RESEND_API_KEY;

    if (!key) {
      throw new HttpsError('failed-precondition', 'Resend API key is not configured.');
    }

    const resend = new Resend(key);
    const results: { email: string; success: boolean; id?: string; error?: string }[] = [];

    // Chunk recipients into batches of 50
    for (let i = 0; i < recipients.length; i += 50) {
      const chunk = recipients.slice(i, i + 50);
      const emailBatch = chunk.map((r) => {
        let personalizedHtml = html;
        let personalizedSubject = subject;
        const vars: Record<string, string> = {
          name: r.name || '',
          email: r.email,
          ...(r.variables || {}),
        };

        for (const [k, v] of Object.entries(vars)) {
          const re = new RegExp(`{{\\s*${k}\\s*}}`, 'gi');
          personalizedHtml = personalizedHtml.replace(re, v || '');
          personalizedSubject = personalizedSubject.replace(re, v || '');
        }

        return {
          from,
          to: r.name ? `${r.name} <${r.email}>` : r.email,
          subject: personalizedSubject,
          html: personalizedHtml,
          replyTo: replyTo || undefined,
        };
      });

      try {
        const batchRes = await resend.batch.send(emailBatch);
        if (batchRes.error) {
          logger.warn('Batch failed, falling back to individual sending:', batchRes.error);
          for (const item of emailBatch) {
            try {
              const single = await resend.emails.send(item);
              if (single.error) {
                results.push({ email: typeof item.to === 'string' ? item.to : String(item.to), success: false, error: single.error.message });
              } else {
                results.push({ email: typeof item.to === 'string' ? item.to : String(item.to), success: true, id: single.data?.id });
              }
            } catch (err: any) {
              results.push({ email: typeof item.to === 'string' ? item.to : String(item.to), success: false, error: err?.message || 'Send error' });
            }
          }
        } else if (batchRes.data && Array.isArray((batchRes.data as any).data)) {
          (batchRes.data as any).data.forEach((item: any, idx: number) => {
            results.push({ email: chunk[idx].email, success: true, id: item.id });
          });
        } else {
          chunk.forEach((r) => results.push({ email: r.email, success: true }));
        }
      } catch (err: any) {
        logger.error('Resend batch error, falling back to individual sending:', err);
        for (const item of emailBatch) {
          try {
            const single = await resend.emails.send(item);
            if (single.error) {
              results.push({ email: typeof item.to === 'string' ? item.to : String(item.to), success: false, error: single.error.message });
            } else {
              results.push({ email: typeof item.to === 'string' ? item.to : String(item.to), success: true, id: single.data?.id });
            }
          } catch (e: any) {
            results.push({ email: typeof item.to === 'string' ? item.to : String(item.to), success: false, error: e?.message || 'Send error' });
          }
        }
      }
    }

    const sentCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    return {
      ok: true as const,
      total: recipients.length,
      sentCount,
      failedCount,
      results,
    };
  }
);
