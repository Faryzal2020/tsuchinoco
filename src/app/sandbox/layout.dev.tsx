'use client';

// Login-free sandbox, localhost only. This file is a route only under `next dev` (see next.config.ts),
// so production builds and Firebase Hosting never contain it.
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SandboxProvider, { useSandbox } from '@/components/sandbox/SandboxProvider';
import { SandboxMailProvider } from '@/components/sandbox/SandboxMail';

const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
const LINKS = [
  { href: '/sandbox/orders/', label: 'Orders' },
  { href: '/sandbox/storefront/', label: 'Storefront (staff)' },
  { href: '/sandbox/shop/', label: 'Shop (customer)' },
  { href: '/sandbox/settings/', label: 'Order e-mails' },
  { href: '/sandbox/offering/', label: 'Batch offering' },
  { href: '/sandbox/emails/', label: 'Emails' },
];

export default function SandboxLayout({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { setOk(LOCAL.includes(window.location.hostname)); }, []);
  if (ok === null) return null;
  if (!ok) return <p style={{ padding: 24 }}>The sandbox only runs on localhost.</p>;
  return <SandboxProvider><SandboxMailProvider><Shell>{children}</Shell></SandboxMailProvider></SandboxProvider>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { reset } = useSandbox();
  const isShop = pathname.startsWith('/sandbox/shop');
  return (
    <>
      <header className="no-print sticky top-0 z-40 border-b border-line bg-yellow-soft">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
          <span className="font-bold">Sandbox</span>
          <span className="text-sm text-ink-2">Sample data, signed in as a test staff member. Nothing is saved to Firebase; reloading starts over.</span>
          <nav className="flex flex-wrap gap-1" aria-label="Sandbox">
            {LINKS.map((l) => <Link key={l.href} href={l.href} className="nav-link" aria-current={pathname.startsWith(l.href) ? 'page' : undefined}>{l.label}</Link>)}
          </nav>
          <button type="button" className="btn btn-sm ml-auto" onClick={reset}>Reset sample data</button>
        </div>
      </header>
      {isShop ? children : <main className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>}
    </>
  );
}
