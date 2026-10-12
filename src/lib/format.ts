export const formatMoney = (n: number, currency = 'IDR'): string => {
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US');
  const sign = n < 0 ? '−' : '';
  return `${sign}${currency} ${abs}`;
};

export const formatInt = (n: number): string => Math.round(n).toLocaleString('en-US');

export const formatDate = (iso: string | number | undefined | null): string => {
  if (!iso) return '';
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const formatDateTime = (ms: number | undefined | null): string => {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export const addDaysIso = (iso: string, days: number): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export const isPastIso = (iso: string | undefined): boolean => !!iso && iso < todayIso();

export const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const STATUS_LABELS: Record<string, string> = {
  awaiting_pickup: 'Awaiting pickup',
  collected: 'Collected',
  not_collected: 'Not collected',
  awaiting_shipment: 'Awaiting shipment',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  fulfilled: 'Fulfilled',
  upcoming: 'Upcoming',
  wrapped: 'Wrapped',
  finalized: 'Finalised',
  opening: 'Opening',
  received: 'Received',
  pickup: 'Pickup',
  walkin: 'Walk-in',
  correction: 'Correction',
  reversal: 'Reversal',
};

export const statusLabel = (s: string) => STATUS_LABELS[s] ?? titleCase(s.replace(/_/g, ' '));
