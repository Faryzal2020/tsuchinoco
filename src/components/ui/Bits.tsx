'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { statusLabel } from '@/lib/format';

type Tone = 'neutral' | 'blue' | 'yellow' | 'green' | 'red';

export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn('pill', `pill-${tone}`, className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  awaiting_pickup: 'yellow',
  collected: 'green',
  not_collected: 'red',
  awaiting_shipment: 'yellow',
  shipped: 'green',
  cancelled: 'neutral',
  draft: 'neutral',
  open: 'green',
  closed: 'yellow',
  fulfilled: 'blue',
  upcoming: 'blue',
  wrapped: 'neutral',
  finalized: 'green',
  opening: 'blue',
  received: 'green',
  pickup: 'yellow',
  walkin: 'yellow',
  correction: 'neutral',
  reversal: 'red',
};

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONES[status] ?? 'neutral'}>{statusLabel(status)}</Pill>;
}

export function Panel({ children, className, pad = true }: { children: React.ReactNode; className?: string; pad?: boolean }) {
  return <div className={cn('panel', pad && 'panel-pad', className)}>{children}</div>;
}

export function PageHeader({ title, eyebrow, actions, children }: { title: React.ReactNode; eyebrow?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-[26px] font-bold leading-tight">{title}</h1>
        {children && <div className="mt-1 text-ink-2">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, current, hrefFor }: { tabs: { id: string; label: string }[]; current: string; hrefFor: (id: string) => string }) {
  return (
    <nav className="tabs mb-5" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.id} href={hrefFor(t.id)} className="tab" aria-current={t.id === current ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="panel px-6 py-10 text-center">
      <div className="text-base font-bold">{title}</div>
      {children && <div className="mt-1 text-sm text-ink-2 max-w-md mx-auto">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'yellow' | 'blue' }) {
  return (
    <div className={cn('panel panel-pad', tone === 'yellow' && 'bg-yellow-soft border-yellow-2/40', tone === 'blue' && 'bg-blue-soft border-blue/30')}>
      <div className="eyebrow">{label}</div>
      <div className="stat-num mt-1">{value}</div>
      {sub && <div className="hint mt-1">{sub}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="py-16 text-center text-sm text-muted">{label}</div>;
}

export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('tbl-wrap', className)}><table className="tbl">{children}</table></div>;
}

export function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-line last:border-b-0 text-sm">
      <span className="text-ink-2">{k}</span>
      <span className="font-semibold text-right">{v}</span>
    </div>
  );
}
