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
  priceJpy?: number;  // optional JPY price (falls back to item.priceJpy)
  /** media id; overrides the item thumbnail on forms */
  thumbnailId?: string;
}

export interface BundleComponent {
  itemId: string;
  variantId?: string;
  /** Allowed variant IDs if customer can choose (e.g. sizes or language editions) */
  allowedVariantIds?: string[];
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
  /** media id shown on forms */
  thumbnailId?: string;
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
  /** Short upper-case code used in order IDs, e.g. CF23. Derived from the name when blank. */
  code?: string;
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

/** In-house form. formId equals the batch id and points at forms/{formId}. */
export interface InhouseBatchForm {
  provider: 'inhouse';
  formId: string;
  url: string;
  generatedAt: number;
}

/** Legacy JotForm link. Needs the Cloud Functions, which need the Blaze plan. */
export interface JotformBatchForm {
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

export type BatchForm = InhouseBatchForm | JotformBatchForm;

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
  /** If this line is a bundle, map of component itemId -> chosen variantId */
  bundleSelections?: Record<string, string>;
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

// ---- Media (Cloud Storage or inline data URLs) ----

export interface Media {
  id: string;
  kind: 'thumbnail' | 'image';
  mime: string;
  dataUrl?: string;
  url?: string;
  storagePath?: string;
  width: number;
  height: number;
  bytes: number;
  name: string;
  createdAt: number;
  createdBy: string;
}

// ---- In-house forms ----

export interface FormTheme {
  background: string;
  surface: string;
  accent: string;
  text: string;
  font: 'sans' | 'serif' | 'rounded';
  width: 'narrow' | 'normal' | 'wide';
  radius: 'sharp' | 'soft' | 'round';
}

export type ProductsSource =
  | { kind: 'type'; type: string }
  | { kind: 'bundles' }
  | { kind: 'all' }
  | { kind: 'entries'; keys: string[] };

export type FormBlock =
  | { id: string; type: 'header'; title: string; subtitle?: string; imageId?: string }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; imageId: string; caption?: string; size: 'full' | 'half' }
  | { id: string; type: 'divider' }
  | { id: string; type: 'section'; title: string; description?: string }
  | { id: string; type: 'products'; title?: string; source: ProductsSource; layout: 'list' | 'grid'; showThumbnails: boolean; showPrices: boolean }
  | { id: string; type: 'payment_instructions'; title?: string; text?: string; imageId?: string }
  | { id: string; type: 'customer' }
  | { id: string; type: 'fulfilment' }
  | { id: string; type: 'notes' }
  | { id: string; type: 'submit' };

export type FormBlockType = FormBlock['type'];

export interface FormSettings {
  /** Labels offered for pickup, e.g. "Day 1 (31 October 2026)". */
  pickupDays: string[];
  maxQtyPerLine: number;
  requirePhone: boolean;
  requireEmail: boolean;
  thankYouMessage: string;
  closedMessage: string;
}

/** Editable form definition. One per batch; the id is the batch id. */
export interface FormDoc {
  id: string;
  eventId: string;
  batchId: string;
  title: string;
  theme: FormTheme;
  blocks: FormBlock[];
  labels: Record<string, string>;
  settings: FormSettings;
  /** Desired accepting state; mirrored to the public snapshot. */
  enabled: boolean;
  publishedAt?: number;
  publishedHash?: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  theme: FormTheme;
  blocks: FormBlock[];
  labels: Record<string, string>;
  settings: FormSettings;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

/** One sellable row on the public form. key is the variant key or the bundle item id. */
export interface PublicProduct {
  key: string;
  itemId: string;
  variantId?: string;
  name: string;
  variantName: string;
  price: number;
  thumb?: string;
}

/** One card on the public form: an item with its offered variants (or a bundle). */
export interface PublicProductGroup {
  itemId: string;
  name: string;
  kind: ItemKind;
  thumb?: string;
  products: PublicProduct[];
}

/** Public blocks are form blocks with media and products resolved. */
export type PublicBlock = FormBlock & { src?: string; groups?: PublicProductGroup[] };

/** The published snapshot customers read. Must stay under 1 MiB. */
export interface PublicForm {
  id: string;
  formId: string;
  eventId: string;
  batchId: string;
  enabled: boolean;
  mode: BatchMode;
  title: string;
  theme: FormTheme;
  labels: Record<string, string>;
  settings: FormSettings;
  currency: string;
  blocks: PublicBlock[];
  /** Every orderable key with the data the import and the rules need. */
  items: Record<string, { name: string; variantName: string; price: number; kind: ItemKind }>;
  maxQtyPerLine: number;
  publishedAt: number;
  version: number;
}

export type SubmissionStatus = 'new' | 'imported' | 'rejected';

/** Written by the customer. Lines are a map key -> qty so the rules can check the keys. */
export interface Submission {
  id: string;
  formId: string;
  eventId: string;
  batchId: string;
  version: number;
  code: string;
  customer: { name: string; email: string; phone: string; address?: string };
  fulfilment: Fulfilment;
  pickupDay?: string;
  paymentProofUrl?: string;
  notes: string;
  lines: Record<string, number>;
  submittedAt: number;
  status: SubmissionStatus;
  orderId?: string;
  rejectReason?: string;
}

export interface Counter {
  id: string; // = batchId
  next: number;
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

export type LogAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'bulk_create'
  | 'bulk_update'
  | 'bulk_delete'
  | 'clear'
  | 'publish'
  | 'status_change';

export type LogEntityType =
  | 'item'
  | 'event'
  | 'batch'
  | 'order'
  | 'submission'
  | 'form'
  | 'staff'
  | 'settings'
  | 'movement'
  | 'wrapup';

export interface LogEntry {
  id: string;
  action: LogAction;
  entityType: LogEntityType;
  entityId?: string;
  entityName?: string;
  details: string;
  createdAt: number;
  createdBy: string;
}

