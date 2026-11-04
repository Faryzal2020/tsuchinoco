// Firebase usage against the no-cost quotas (Spark, and the same allowance on Blaze).
// Numbers come from the `usageMetrics` callable, which reads Cloud Monitoring.
import { useCallback, useEffect, useState } from 'react';
import { fx } from './functions';

export interface DailyValue { day: number; value: number }

export interface UsageReport {
  generatedAt: number;
  projectId: string;
  /** Pacific-time midnight; Firebase daily quotas reset here. */
  dayStart: number;
  monthStart: number;
  firestore: {
    reads: number | null;
    writes: number | null;
    deletes: number | null;
    storedBytes: number | null;
    daily: { reads: DailyValue[] | null; writes: DailyValue[] | null; deletes: DailyValue[] | null };
  };
  storage: {
    bucket: string | null;
    location: string | null;
    storedBytes: number | null;
    objects: number | null;
    egressMonth: number | null;
    egressDaily: DailyValue[] | null;
    classAMonth: number | null;
    classBMonth: number | null;
    ops: { method: string; count: number }[];
  };
  hosting: { storedBytes: number | null; egressToday: number | null; egressDaily: DailyValue[] | null };
  functions: { requestsMonth: number | null; byService: { name: string; count: number }[] };
  errors: string[];
}

const GB = 1e9;
const GiB = 1024 ** 3;
const MB = 1e6;

// From firebase.google.com/pricing. Storage figures are for *.firebasestorage.app buckets.
export const FREE_LIMITS = {
  firestore: { storedBytes: GiB, readsPerDay: 50_000, writesPerDay: 20_000, deletesPerDay: 20_000 },
  storage: { storedBytes: 5 * GB, egressPerMonth: 100 * GB, uploadsPerMonth: 5_000, downloadsPerMonth: 50_000 },
  hosting: { storedBytes: 10 * GB, egressPerDay: 360 * MB },
  functions: { invocationsPerMonth: 2_000_000 },
} as const;

/** Cloud Storage only has a no-cost allowance in these regions. */
export const FREE_STORAGE_REGIONS = ['us-central1', 'us-east1', 'us-west1'];

export function useUsageReport() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await fx.usageMetrics({}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Usage function not reachable');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { report, loading, error, refresh };
}
