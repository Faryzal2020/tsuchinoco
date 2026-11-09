import * as fs from 'fs';
import * as path from 'path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { requireStaff } from './common';

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
// Compiled to lib/functions/src/, so the functions folder is three levels up from here.
loadEnvFile(path.resolve(__dirname, '../../../.env.local'));
loadEnvFile(path.resolve(__dirname, '../../../.env'));
loadEnvFile(path.resolve(__dirname, '../.env.local'));
loadEnvFile(path.resolve(__dirname, '../.env'));
loadEnvFile(path.resolve(__dirname, '../../.env.local'));
loadEnvFile(path.resolve(__dirname, '../../.env'));
loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

initializeApp();

const REGION = 'asia-southeast1';
setGlobalOptions({ region: REGION, maxInstances: 5, invoker: 'public' });

// ---- Usage metrics (Cloud Monitoring) ----
// Reads the same counters the Firebase usage pages show, so staff can compare them with the
// no-cost quotas from Settings. Needs the Cloud Monitoring API and monitoring.timeSeries.list
// on the runtime service account (the default compute account has it through Editor).

type Point = { end: number; value: number };
type Series = { labels: Record<string, string>; points: Point[] };

const DAY = 86400;
const PT = 'America/Los_Angeles'; // Firebase daily quotas and billing months follow Pacific time

/** Pacific-time offset from UTC at an instant, in ms (negative). */
function ptOffset(at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}

/** Start of the Pacific-time day or month containing `at`, as epoch ms. */
function ptStart(at: number, unit: 'day' | 'month'): number {
  const wall = new Date(at + ptOffset(at));
  const midnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), unit === 'month' ? 1 : wall.getUTCDate());
  return midnight - ptOffset(midnight - ptOffset(at));
}

async function monitoringQuery(
  project: string,
  token: string,
  filter: string,
  end: number,
  periodSec: number,
  periods: number,
  aligner: string,
  reducer: string,
  groupBy: string[] = [],
): Promise<Series[]> {
  const params = new URLSearchParams({
    filter,
    'interval.startTime': new Date(end - periodSec * periods * 1000).toISOString(),
    'interval.endTime': new Date(end).toISOString(),
    'aggregation.alignmentPeriod': `${periodSec}s`,
    'aggregation.perSeriesAligner': aligner,
    'aggregation.crossSeriesReducer': reducer,
  });
  for (const g of groupBy) params.append('aggregation.groupByFields', g);
  const res = await fetch(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(body?.error?.message || `Cloud Monitoring returned ${res.status}`);
  return (body.timeSeries ?? []).map((ts: any) => ({
    labels: { ...ts.resource?.labels, ...ts.metric?.labels },
    points: (ts.points ?? []).map((pt: any) => ({
      end: Date.parse(pt.interval.endTime),
      value: Number(pt.value.int64Value ?? pt.value.doubleValue ?? 0),
    })),
  }));
}

const sumAll = (series: Series[]) => series.reduce((n, s) => n + s.points.reduce((m, p) => m + p.value, 0), 0);

export const usageMetrics = onCall({ invoker: 'public', cors: true }, async (req) => {
  await requireStaff(req);
  const config = JSON.parse(process.env.FIREBASE_CONFIG || '{}') as { projectId?: string; storageBucket?: string };
  const project = config.projectId || process.env.GCLOUD_PROJECT;
  if (!project) throw new HttpsError('failed-precondition', 'Project id is not available to the function.');
  const bucket = config.storageBucket || null;
  const { access_token: token } = await applicationDefault().getAccessToken();

  const now = Date.now();
  const dayStart = ptStart(now, 'day');
  const monthStart = ptStart(now, 'month');
  // One aligned window from the start of the period to now (Monitoring needs at least 60 s).
  const sinceDay = Math.max(60, Math.ceil((now - dayStart) / 1000));
  const sinceMonth = Math.max(60, Math.ceil((now - monthStart) / 1000));
  const errors: string[] = [];

  const q = (label: string, run: () => Promise<Series[]>) =>
    run().catch((e: unknown) => {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
  const metric = (type: string, extra = '') => `metric.type="${type}"${extra}`;
  const deltaSince = (type: string, sec: number, extra = '', groupBy: string[] = []) =>
    q(type, () => monitoringQuery(project, token, metric(type, extra), now, sec, 1, 'ALIGN_SUM', 'REDUCE_SUM', groupBy));
  // Seven full Pacific days ending at today's midnight (DST weeks drift by an hour; fine for a trend).
  const deltaDaily = (type: string, extra = '') =>
    q(type, () => monitoringQuery(project, token, metric(type, extra), dayStart, DAY, 7, 'ALIGN_SUM', 'REDUCE_SUM'));
  const gauge = (type: string, extra = '', reducer = 'REDUCE_SUM', groupBy: string[] = []) =>
    q(type, () => monitoringQuery(project, token, metric(type, extra), now, 3 * DAY, 1, 'ALIGN_NEXT_OLDER', reducer, groupBy));

  const daily = (series: Series[] | null) => {
    if (!series) return null;
    const byEnd = new Map<number, number>();
    for (const s of series) for (const p of s.points) byEnd.set(p.end, (byEnd.get(p.end) ?? 0) + p.value);
    return Array.from({ length: 7 }, (_, i) => {
      const end = dayStart - (6 - i) * DAY * 1000;
      return { day: end - DAY * 1000, value: byEnd.get(end) ?? 0 };
    });
  };
  const total = (series: Series[] | null) => (series ? sumAll(series) : null);

  const bucketFilter = bucket ? ` AND resource.label.bucket_name="${bucket}"` : '';
  const [
    fsReads, fsWrites, fsDeletes, fsStored, fsReadsDaily, fsWritesDaily, fsDeletesDaily,
    gcsBytes, gcsObjects, gcsEgress, gcsEgressDaily, gcsOps,
    hostStored, hostEgress, hostEgressDaily,
    fnRequests,
  ] = await Promise.all([
    deltaSince('firestore.googleapis.com/document/read_ops_count', sinceDay),
    deltaSince('firestore.googleapis.com/document/write_ops_count', sinceDay),
    deltaSince('firestore.googleapis.com/document/delete_ops_count', sinceDay),
    gauge('firestore.googleapis.com/storage/data_and_index_storage_bytes'),
    deltaDaily('firestore.googleapis.com/document/read_ops_count'),
    deltaDaily('firestore.googleapis.com/document/write_ops_count'),
    deltaDaily('firestore.googleapis.com/document/delete_ops_count'),
    gauge('storage.googleapis.com/storage/v2/total_bytes', bucketFilter, 'REDUCE_SUM', ['resource.label.location']),
    gauge('storage.googleapis.com/storage/object_count', bucketFilter),
    deltaSince('storage.googleapis.com/network/sent_bytes_count', sinceMonth, bucketFilter),
    deltaDaily('storage.googleapis.com/network/sent_bytes_count', bucketFilter),
    deltaSince('storage.googleapis.com/api/request_count', sinceMonth, bucketFilter, ['metric.label.method']),
    // web.app and firebaseapp.com report the same site storage, so take the largest, not the sum.
    gauge('firebasehosting.googleapis.com/storage/total_bytes', '', 'REDUCE_MAX'),
    deltaSince('firebasehosting.googleapis.com/network/sent_bytes_count', sinceDay),
    deltaDaily('firebasehosting.googleapis.com/network/sent_bytes_count'),
    deltaSince('run.googleapis.com/request_count', sinceMonth, ' AND resource.type="cloud_run_revision"', ['resource.label.service_name']),
  ]);

  // Uploads, listings and metadata edits are Class A; reads and metadata gets are Class B; deletes are free.
  const ops = (gcsOps ?? [])
    .map((s) => ({ method: s.labels.method || 'other', count: sumAll([s]) }))
    .filter((o) => o.count > 0)
    .sort((a, b) => b.count - a.count);
  const classOf = (m: string) => (/^(Read|Get)/.test(m) ? 'B' : /^Delete/.test(m) ? 'free' : 'A');

  return {
    generatedAt: now,
    projectId: project,
    dayStart,
    monthStart,
    firestore: {
      reads: total(fsReads),
      writes: total(fsWrites),
      deletes: total(fsDeletes),
      storedBytes: total(fsStored),
      daily: { reads: daily(fsReadsDaily), writes: daily(fsWritesDaily), deletes: daily(fsDeletesDaily) },
    },
    storage: {
      bucket,
      location: gcsBytes?.[0]?.labels.location ?? null,
      storedBytes: total(gcsBytes),
      objects: total(gcsObjects),
      egressMonth: total(gcsEgress),
      egressDaily: daily(gcsEgressDaily),
      classAMonth: gcsOps ? ops.filter((o) => classOf(o.method) === 'A').reduce((n, o) => n + o.count, 0) : null,
      classBMonth: gcsOps ? ops.filter((o) => classOf(o.method) === 'B').reduce((n, o) => n + o.count, 0) : null,
      ops,
    },
    hosting: {
      storedBytes: total(hostStored),
      egressToday: total(hostEgress),
      egressDaily: daily(hostEgressDaily),
    },
    functions: {
      requestsMonth: total(fnRequests),
      byService: (fnRequests ?? [])
        .map((s) => ({ name: s.labels.service_name || 'other', count: sumAll([s]) }))
        .filter((f) => f.count > 0)
        .sort((a, b) => b.count - a.count),
    },
    errors,
  };
});

// ---- Orders: server-side import and order-update e-mails (storefront phase C) ----
export { importSubmissionOnCreate, orderEmailsOnWrite, resendOrderEmail } from './orders';

// ---- Mail: shared inbox, contact form and send queue (Mail phase) ----
// Broadcasts used to be sent directly by sendBroadcastEmail; they now go through queueBroadcast.
export { contactOnCreate, drainMailQueue, listMailInboxes, mailQueueOnCreate, mailWebhook, queueBroadcast, queueMail, renameMailInbox } from './mail';
