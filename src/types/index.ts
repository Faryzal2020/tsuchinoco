// Domain types. Prices and totals are whole integers in the circle's currency.
// Every variant is addressed by the pair itemId + variantId; as a map key this
// is written `itemId:variantId` (see variantKey in lib/keys.ts).

export type ItemKind = 'product' | 'bundle';

export interface Variant {
  id: string;
  name: string;
  active: boolean;
  sku?: string;
  price?: number;     // specific variant PO price (falls back to item.price)
  otsPrice?: number;  // specific variant OTS price (falls back to item.otsPrice)
  priceJpy?: number;  // optional C107 / JPY price (falls back to item.priceJpy)
}

export interface BundleComponent {
  itemId: string;
  variantId: string;
  qty: number;
  /** Explicit per-unit price for this component inside the bundle. Absent = proportional split. */
  allocatedPrice?: number;
}

export interface Item {
  id: string;
  sku?: string;
  name: string;
  kind: ItemKind;
  type: string;
  category?: string;
  artist?: string;
  managerId: string;
  managerName?: string;
  price: number;
  otsPrice?: number;
  priceJpy?: number;
  cost?: number;
  producedAt: string;
  active: boolean;
  variants: Variant[];
  components: BundleComponent[];
  notes: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export interface Staff {
  id: string; // lower-cased email
  email: string;
  displayName: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export type EventStatus = 'upcoming' | 'wrapped';

export interface Event {
  id: string;
  name: string;
  startDate: string; // ISO date, YYYY-MM-DD
  endDate: string;
  venue: string;
  status: EventStatus;
  pickupDeadlineDays: number;
  notes: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export type BatchMode = 'preorder' | 'post';
export type BatchStatus = 'draft' | 'open' | 'closed' | 'fulfilled';

export interface OfferingEntry {
  itemId: string;
  /** Absent for bundles. */
  variantId?: string;
  /** Optional event-specific preorder price override */
  overridePrice?: number;
  /** Optional event-specific OTS/walk-in price override */
  overrideOtsPrice?: number;
}

export interface BatchForm {
  provider: 'jotform';
  formId: string;
  url: string;
  /** JotForm question id -> variantKey (products) or itemId (bundles). */
  fieldMap: Record<string, string>;
  customerFields: {
    name: string;
    email: string;
    phone: string;
    fulfilment?: string;
    address: string;
  };
  generatedAt: number;
}

export interface PlanningInputs {
  onsiteExtra: number;
  ordered: number;
  received: number;
}

export interface Batch {
  id: string;
  eventId: string;
  number: number;
  mode: BatchMode;
  status: BatchStatus;
  opensAt: string; // ISO date or ''
  closesAt: string;
  offering: OfferingEntry[];
  form?: BatchForm;
  planning: Record<string, PlanningInputs>; // keyed by variantKey
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export type Fulfilment = 'pickup' | 'mail';
export type OrderSource = 'jotform' | 'manual' | 'web';
export type OrderStatus =
  | 'awaiting_pickup'
  | 'collected'
  | 'not_collected'
  | 'awaiting_shipment'
  | 'shipped'
  | 'cancelled';

export const OPEN_ORDER_STATUSES: OrderStatus[] = ['awaiting_pickup', 'not_collected', 'awaiting_shipment'];

export interface RawLine {
  itemId: string;
  variantId?: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderLine {
  itemId: string;
  variantId: string;
  qty: number;
  unitPrice: number;
  fromBundleItemId?: string;
}

export interface Order {
  id: string;
  eventId: string;
  batchId: string;
  source: OrderSource;
  externalId: string;
  transactionId?: string;
  pickupDay?: string;
  paymentProofUrl?: string;
  submittedAt: number;
  customer: { name: string; email: string; phone: string; address?: string };
  fulfilment: Fulfilment;
  status: OrderStatus;
  rawLines: RawLine[];
  lines: OrderLine[];
  total: number;
  contact?: { contactedAt: number; note: string };
  returnToStockBy?: string; // ISO date
  collectedAt?: number;
  shippedAt?: number;
  cancelledAt?: number;
  notes: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export type MovementReason = 'opening' | 'received' | 'pickup' | 'walkin' | 'shipped' | 'correction' | 'reversal';

export interface StockMovement {
  id: string;
  itemId: string;
  variantId: string;
  qty: number;
  reason: MovementReason;
  eventId?: string;
  batchId?: string;
  orderId?: string;
  note: string;
  createdAt: number;
  createdBy: string;
}

export interface WrapupRow {
  brought: number | null;
  leftover: number | null;
  editedBy?: string;
}

export interface Wrapup {
  id: string; // = eventId
  status: 'draft' | 'finalized';
  rows: Record<string, WrapupRow>; // keyed by variantKey
  bundlesSold: Record<string, number>; // keyed by bundle itemId
  finalizedAt?: number;
  finalizedBy?: string;
  movementIds: string[];
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export interface Settings {
  currency: string;
  itemTypes: string[];
  pickupDeadlineDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  currency: 'IDR',
  itemTypes: [
    'Acrylic Keychain',
    'Acrylic Standee',
    'Book Comic',
    'Poster A3',
    'Poster A5',
    'Sticker',
    'T-Shirt',
    'Bundle',
    'Other',
  ],
  pickupDeadlineDays: 30,
};
