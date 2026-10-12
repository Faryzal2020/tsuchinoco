'use client';

import React, { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loading } from '@/components/ui/Bits';

/** Read and update URL query params. Static export has no dynamic routes, so ids live in the query. */
export function useQuery() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string, fallback = '') => sp.get(k) ?? fallback;
  const set = (patch: Record<string, string | null>, replace = true) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (replace) router.replace(url); else router.push(url);
  };
  return { get, set, sp };
}

/** useSearchParams needs a Suspense boundary in static export; wrap page bodies with this. */
export function QueryPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
