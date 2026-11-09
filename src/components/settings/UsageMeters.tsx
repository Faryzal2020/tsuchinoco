'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { DailyValue } from '@/lib/usage';
import { Pill } from '@/components/ui/Bits';

export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${Math.round(n)} B`;
}

export const fmtCount = (n: number) => Math.round(n).toLocaleString('en-US');

const PT_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', weekday: 'short', day: 'numeric', month: 'short' });

/** Used vs. a no-cost limit. `used === null` means the metric could not be read. */
export function Meter({
  label,
  used,
  limit,
  format = fmtCount,
  sub,
  per,
}: {
  label: string;
  used: number | null | undefined;
  limit: number;
  format?: (n: number) => string;
  sub?: React.ReactNode;
  /** Quota period shown after the limit, e.g. "day" → "/ 50,000 free per day". */
  per?: 'day' | 'month';
}) {
  const known = typeof used === 'number';
  const pct = known ? (used / limit) * 100 : 0;
  const tone = pct >= 100 ? 'red' : pct >= 80 ? 'yellow' : 'blue';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-ink-2">
          {known ? <b className="text-ink">{format(used)}</b> : '—'} / {format(limit)}{per ? ` free per ${per}` : ' free'}
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full border border-line bg-cream-2"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={known ? used : undefined}
      >
        {known && (
          <div
            className={cn('h-full rounded-full', tone === 'red' ? 'bg-red' : tone === 'yellow' ? 'bg-yellow-2' : 'bg-blue')}
            style={{ width: `${Math.min(100, Math.max(pct > 0 ? 1.5 : 0, pct))}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted">
        <span>{sub}</span>
        {!known ? (
          <span>No data</span>
        ) : pct >= 100 ? (
          <Pill tone="red">Over free limit</Pill>
        ) : pct >= 80 ? (
          <Pill tone="yellow">{pct.toFixed(0)}% · near limit</Pill>
        ) : (
          <span className="tabular-nums">{pct < 0.1 && used > 0 ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}% used</span>
        )}
      </div>
    </div>
  );
}

/** Seven full Pacific days plus today's partial bar, scaled to the largest day. */
export function DailyBars({
  label,
  days,
  today,
  format = fmtCount,
}: {
  label: string;
  days: DailyValue[] | null | undefined;
  today?: number | null;
  format?: (n: number) => string;
}) {
  if (!days) return null;
  const bars = [...days.map((d) => ({ ...d, today: false })), { day: 0, value: today ?? 0, today: true }];
  const max = Math.max(1, ...bars.map((b) => b.value));
  const avg = days.reduce((n, d) => n + d.value, 0) / days.length;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-ink-2">{label}</span>
        <span className="text-muted tabular-nums">7-day avg {format(avg)}/day</span>
      </div>
      <div className="mt-1 flex h-12 items-end gap-[3px]" role="img" aria-label={`${label}, last 7 days`}>
        {bars.map((b, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end" title={`${b.today ? 'Today so far' : PT_DAY.format(b.day)}: ${format(b.value)}`}>
            <div
              className={cn('w-full rounded-t-[4px]', b.today ? 'bg-blue/40' : 'bg-blue', 'group-hover:bg-blue-2')}
              style={{ height: `${Math.max(b.value > 0 ? 6 : 2, (b.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-0.5 flex gap-[3px] text-[10px] text-muted">
        {bars.map((b, i) => (
          <span key={i} className="flex-1 text-center">{b.today ? 'now' : PT_DAY.format(b.day).slice(0, 2)}</span>
        ))}
      </div>
    </div>
  );
}
