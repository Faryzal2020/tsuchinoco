'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { usePrefs } from '@/lib/prefs';
import { isFirebaseConfigured } from '@/lib/firebase';
import Button from '@/components/ui/Button';
import { Checkbox, Select } from '@/components/ui/Field';
import { Loading } from '@/components/ui/Bits';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/events/', label: 'Events' },
  { href: '/catalog/', label: 'Catalogue' },
  { href: '/stock/', label: 'Stock' },
  { href: '/settings/', label: 'Settings' },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 no-underline">
      <span className="inline-block h-6 w-6 rounded-md bg-yellow border-[1.5px] border-yellow-2" aria-hidden="true" />
      <span className="text-[17px] font-bold tracking-tight text-ink">Tsuchinoco Ops</span>
    </Link>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { state, signIn, signOut } = useAuth();

  if (!isFirebaseConfigured) {
    return (
      <Centered title="Firebase is not configured">
        <p>Copy <code>env.template</code> to <code>.env.local</code> and fill in the Firebase web app values, then restart the dev server. See <code>docs/DEPLOYMENT.md</code>.</p>
      </Centered>
    );
  }
  if (state.phase === 'loading') return <Loading label="Signing in…" />;
  if (state.phase === 'signed_out') {
    return (
      <Centered title="Sign in to continue">
        <p className="mb-5 text-ink-2">Staff only. Use the Google account that is on the staff list.</p>
        <Button variant="primary" size="lg" onClick={() => signIn().catch((e) => alert(e.message))}>Sign in with Google</Button>
      </Centered>
    );
  }
  if (state.phase === 'not_staff') {
    return (
      <Centered title="Not on the staff list">
        <p className="mb-2 text-ink-2">You are signed in as <b>{state.user.email}</b>, but that address is not an active staff account.</p>
        <p className="mb-5 text-ink-2">Ask a staff member to add you from Settings, then sign in again.</p>
        <Button onClick={signOut}>Sign out</Button>
      </Centered>
    );
  }
  return <>{children}</>;
}

function Centered({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="panel panel-pad w-full max-w-md text-center">
        <div className="mb-4 flex justify-center"><Brand /></div>
        <h1 className="mb-3 text-xl font-bold">{title}</h1>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}

function TopBar() {
  const pathname = usePathname();
  const { state, signOut, meName } = useAuth();
  const { events, loaded } = useData();
  const { currentEventId, setCurrentEventId, mineOnly, setMineOnly } = usePrefs();
  if (state.phase !== 'ready') return null;
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
        <Brand />
        <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="nav-link" aria-current={isActive(n.href) ? 'page' : undefined}>{n.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="hidden text-ink-2 sm:inline">Event</span>
            <Select small value={currentEventId} onChange={(e) => setCurrentEventId(e.target.value)} className="w-[200px]" disabled={!loaded}>
              {events.length === 0 && <option value="">No events yet</option>}
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </label>
          <Checkbox label="My items only" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          <span className="hidden text-sm text-ink-2 md:inline">{meName}</span>
          <Button size="sm" onClick={signOut}>Sign out</Button>
        </div>
      </div>
    </header>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Gate>
      <TopBar />
      <main className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6">
        <DataGate>{children}</DataGate>
      </main>
    </Gate>
  );
}

function DataGate({ children }: { children: React.ReactNode }) {
  const { loaded } = useData();
  if (!loaded) return <Loading label="Loading data…" />;
  return <>{children}</>;
}
