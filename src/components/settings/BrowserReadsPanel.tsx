'use client';

import { fmtCount } from '@/components/settings/UsageMeters';
import { resetReadMeter, useReadMeter } from '@/lib/readMeter';
import Button from '@/components/ui/Button';
import { Panel } from '@/components/ui/Bits';

const READ_LABELS: Record<string, string> = {
  staff: 'Staff list',
  items: 'Catalogue items',
  events: 'Events',
  batches: 'Batches',
  openOrders: 'Open orders',
  movements: 'Stock movements (full history)',
  wrapups: 'Wrap-ups',
  forms: 'Forms',
  publicForms: 'Published forms',
  submissions: 'New submissions',
  templates: 'Form templates',
  themePresets: 'Theme presets',
  publicPrices: 'Live price list',
  storeCatalog: 'Storefront catalogue',
  storeStatus: 'Storefront status',
  settings: 'Settings',
  myStaffRecord: 'Your staff record',
  eventOrders: 'Orders of one event',
  ordersForEvents: 'Orders, All view',
  logs: 'Activity log',
  'mail:threads': 'Mail conversations',
  'mail:sent': 'Sent mail',
  'mail:waiting': 'Mail waiting to send',
  'mail:thread': 'Messages of opened conversations',
  'mail:customerOrders': 'Orders beside a conversation',
  'mail:quota': 'Mail quota counters',
  'settings:media': 'Media count (this page)',
  'priceSync:items': 'Price list sync',
  priceHistory: 'Price history',
};

/** Reads made by this browser today, per listener, to find what uses the Firestore quota. */
export default function BrowserReadsPanel() {
  const m = useReadMeter();
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="font-bold">Reads by this browser today</h2>
        <Button size="sm" variant="quiet" onClick={resetReadMeter} disabled={m.total === 0}>Reset</Button>
      </div>
      <p className="hint mb-3">
        An estimate counted in this browser only, since midnight Pacific time. Each staff device keeps its own count; add them up to compare with Document reads above.
        Loading counts a list&apos;s full size every time it starts, as Firestore bills after more than 30 minutes away; a quick reload may cost less.
      </p>
      {m.rows.length === 0 ? (
        <p className="hint text-xs">Nothing counted yet today.</p>
      ) : (
        <div className="grid gap-0.5 text-xs">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.5rem)] gap-3 font-semibold text-ink-2 pb-1">
            <span>Data</span><span className="text-right">Loading</span><span className="text-right">Changes</span><span className="text-right">Total</span>
          </div>
          {m.rows.map((r) => (
            <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.5rem)] gap-3 tabular-nums" title={`${r.starts} load${r.starts === 1 ? '' : 's'}`}>
              <span className="truncate text-ink-2">{READ_LABELS[r.name] ?? r.name}{r.starts > 1 && <span className="text-muted"> ×{r.starts}</span>}</span>
              <span className="text-right">{fmtCount(r.loads)}</span>
              <span className="text-right">{fmtCount(r.updates)}</span>
              <span className="text-right font-semibold">{fmtCount(r.loads + r.updates)}</span>
            </div>
          ))}
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-3 border-t border-line pt-1 mt-1 font-semibold">
            <span>Total</span><span className="text-right tabular-nums">{fmtCount(m.total)}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
