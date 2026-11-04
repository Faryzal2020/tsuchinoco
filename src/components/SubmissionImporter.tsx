'use client';

// The Cloud Function turns new submissions into orders as they arrive. This is the fallback: while
// a staff member has the app open, any submission still new after FALLBACK_AFTER_MS is imported
// here (same code, same transaction, so it can never be imported twice).
// Exposes the queue state so the Orders page can show progress and failures.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { importSubmission, submissionTime } from '@/lib/importer';

/** Give the server this long before the browser steps in. */
export const FALLBACK_AFTER_MS = 2 * 60_000;
import type { Submission } from '@/types';

interface ImporterState {
  pending: Submission[];
  rejected: Submission[];
  busy: boolean;
  errors: Record<string, string>;
  /** Retry everything, including submissions that failed before. */
  importNow: () => Promise<void>;
}

const Ctx = createContext<ImporterState | null>(null);

export function ImporterProvider({ children }: { children: React.ReactNode }) {
  const { submissions, batches, events, itemsById, settings, loaded } = useData();
  const { me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const running = useRef(false);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  const pending = useMemo(() => submissions.filter((s) => s.status === 'new'), [submissions]);
  const rejected = useMemo(() => submissions.filter((s) => s.status === 'rejected'), [submissions]);

  const run = useCallback(async (force: boolean) => {
    if (running.current || !me) return;
    const cutoff = Date.now() - FALLBACK_AFTER_MS;
    const queue = pending.filter((s) => force || (!errors[s.id] && submissionTime(s) <= cutoff));
    if (queue.length === 0) return;
    running.current = true;
    setBusy(true);
    for (const s of queue) {
      try {
        await importSubmission(s.id, { batches, events, itemsById, settings }, me);
        setErrors((prev) => { if (!(s.id in prev)) return prev; const next = { ...prev }; delete next[s.id]; return next; });
      } catch (e) {
        console.error('[importer]', s.id, e);
        setErrors((prev) => ({ ...prev, [s.id]: e instanceof Error ? e.message : 'Import failed' }));
      }
    }
    running.current = false;
    setBusy(false);
  }, [pending, errors, me, batches, events, itemsById, settings]);

  // Give the snapshot a moment to settle, then import whatever is new.
  useEffect(() => {
    if (!loaded || pending.length === 0) return;
    const t = setTimeout(() => { void run(false); }, 600);
    return () => clearTimeout(t);
  }, [loaded, pending, run, tick]);

  const value = useMemo<ImporterState>(() => ({ pending, rejected, busy, errors, importNow: () => run(true) }), [pending, rejected, busy, errors, run]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Idle importer, for the localhost sandbox only. */
export function StaticImporterProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<ImporterState>(() => ({ pending: [], rejected: [], busy: false, errors: {}, importNow: async () => {} }), []);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useImporter(): ImporterState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useImporter outside ImporterProvider');
  return c;
}
