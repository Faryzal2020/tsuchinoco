'use client';

import React, { useEffect, useState } from 'react';
import { AuthProvider } from '@/lib/auth';
import { DataProvider } from '@/lib/data';
import { PrefsProvider } from '@/lib/prefs';
import { ImporterProvider } from '@/components/SubmissionImporter';
import AppShell from '@/components/AppShell';

const PUBLIC_HOSTS = new Set(['tsuchinoco.xyz', 'www.tsuchinoco.xyz']);

export default function StaffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [redirecting, setRedirecting] = useState(() => {
    if (typeof window === 'undefined') return false;
    return PUBLIC_HOSTS.has(window.location.hostname);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = window.location.hostname;
    if (PUBLIC_HOSTS.has(host)) {
      setRedirecting(true);
      const path = window.location.pathname;
      if (path === '/' || path === '') {
        window.location.replace(`/shop/${window.location.search}${window.location.hash}`);
      } else {
        window.location.replace(`https://admin.tsuchinoco.xyz${path}${window.location.search}${window.location.hash}`);
      }
    }
  }, []);

  if (redirecting) {
    return null;
  }

  return (
    <AuthProvider>
      <DataProvider>
        <PrefsProvider>
          <ImporterProvider>
            <AppShell>{children}</AppShell>
          </ImporterProvider>
        </PrefsProvider>
      </DataProvider>
    </AuthProvider>
  );
}
