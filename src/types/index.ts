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
  /** Discount in percent (1–99) for this variant; overrides the item's discount. */
  discountPercent?: number;
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
  /** Discount in percent (1–99), applied to preorder and mail-order prices. */
  discountPercent?: number;
  /** False hides the item from mail order. Absent means sellable by mail order. */
  mailOrder?: boolean;
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
/** `store` is the standing mail-order channel; it never wraps and skips planning. */
export type EventKind = 'event' | 'store';

export interface Event {
  id: string;
  name: string;
  /** Short upper-case code used in order IDs, e.g. CF23. Derived from the name when blank. */
  code?: string;
  startDate: string; // ISO date, YYYY-MM-DD
  endDate: string;
  venue: string;
  status: EventStatus;
  kind?: EventKind;
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
  /** False keeps a preorder batch off the storefront (Form only). Absent means listed. */
  storefront?: boolean;
  planning: Record<string, PlanningInputs>; // keyed by variantKey
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export type Fulfilment = 'pickup' | 'mail';
export type OrderSource = 'jotform' | 'manual' | 'web' | 'store';
/** What the customer asked for: a preorder for one event, or a regular mail order. */
export type OrderType = 'preorder' | 'mail_order';
export type PaymentStatus = 'unpaid' | 'paid';
/** Which catalogue price a line was charged from. */
export type PriceBasis = 'po' | 'ots' | 'override';
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
  /** Price history entry the unit price came from. Absent on orders made before price history. */
  priceEntryId?: string;
  priceBasis?: PriceBasis;
  discountPercent?: number;
  /** The struck-through price the customer saw next to unitPrice, if any. */
  refPrice?: number;
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
  /** Absent on orders made before order types; see orderTypeOf in lib/orders.ts. */
  orderType?: OrderType;
  /** Absent on orders made before payment tracking; see paymentOf in lib/orders.ts. */
  payment?: PaymentStatus;
  paidAt?: number;
  paidBy?: string;
  tracking?: { courier: string; number: string; url?: string };
  /** Payment choice picked at checkout, e.g. "Bank transfer". */
  paymentMethod?: string;
  /** A mail order shipped before the event it waits for ended, released by staff. */
  holdReleased?: boolean;
  /** Set by the importer when the price charged differs from the one the customer saw. */
  priceFlag?: string;
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

export type FormFont = 'sans' | 'serif' | 'rounded' | 'mono';

export interface FormTheme {
  background: string;
  surface: string;
  accent: string;
  text: string;
  font: 'sans' | 'serif' | 'rounded';
  width: 'narrow' | 'normal' | 'wide' | 'widescreen';
  radius: 'sharp' | 'soft' | 'round';
  /** Item price styling. Each is optional: absent means "follow the body text". */
  priceColor?: string;
  priceFont?: 'inherit' | FormFont;
  priceWeight?: 'normal' | 'semibold' | 'bold' | 'black';
  priceSize?: 'sm' | 'md' | 'lg' | 'xl';
}

/** A named theme shared by every staff member, saved from the form editor. */
export interface ThemePresetDoc {
  id: string;
  name: string;
  description: string;
  theme: FormTheme;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export type ProductsSource =
  | { kind: 'type'; type: string }
  | { kind: 'bundles' }
  | { kind: 'all' }
  | { kind: 'entries'; keys: string[] }
  | { kind: 'search'; query: string };

export type FormBlock =
  | { id: string; type: 'header'; title: string; subtitle?: string; imageId?: string }
  | { id: string; type: 'logo'; imageId?: string; background: 'visible' | 'transparent'; align: 'left' | 'center' | 'right'; marginLeft?: number; marginRight?: number; size?: 'sm' | 'md' | 'lg' }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; imageId: string; caption?: string; size: 'full' | 'half' }
  | { id: string; type: 'divider' }
  | { id: string; type: 'section'; title: string; description?: string }
  | { id: string; type: 'products'; title?: string; source: ProductsSource; layout: 'list' | 'grid'; columns?: 1 | 2 | 3 | 4 | 5; columnsMobile?: 1 | 2 | 3; fitThumbnail?: boolean; showThumbnails: boolean; showPrices: boolean }
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
  /** Struck-through reference price shown next to price, e.g. the OTS price on a preorder. */
  refPrice?: number;
  refLabel?: string;
  discountPercent?: number;
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
  /** Accepting window in ms since epoch, from the batch dates. The rules check them against server time. */
  acceptFrom?: number;
  acceptUntil?: number;
  /** Offering price overrides per key; live prices come from publicPrices/current. */
  overrides?: Record<string, number>;
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
  orderType?: OrderType;
  pickupDay?: string;
  paymentProofUrl?: string;
  notes: string;
  lines: Record<string, number>;
  /** Price entry id the customer saw per line key. */
  seen?: Record<string, string>;
  paymentMethod?: string;
  /** Server time of the write, enforced by the rules. A Firestore Timestamp when read. */
  createdAt?: unknown;
  submittedAt: number;
  status: SubmissionStatus;
  orderId?: string;
  rejectReason?: string;
}

export interface Counter {
  id: string; // = batchId
  next: number;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
  updatedAt?: number;
}

// ---- Prices ----

/** One price as it was set at a point in time. Create-only; a correction is a new entry. */
export interface PriceEntry {
  id: string;
  itemId: string;
  /** Variant key for products, item id for bundles. */
  key: string;
  po: number;
  ots: number;
  discountPercent?: number;
  effectiveFrom: number;
  by: string;
  note?: string;
}

export interface LivePrice {
  entryId: string;
  po: number;
  ots: number;
  discountPercent?: number;
  /** When this entry became current. */
  since: number;
  /** The entry it replaced, kept for the checkout grace period. */
  prev?: { entryId: string; po: number; ots: number; discountPercent?: number };
}

/** publicPrices/current: the live price list both customer pages read. Public. */
export interface PublicPrices {
  basis: Record<OrderType, 'po' | 'ots'>;
  graceMinutes: number;
  items: Record<string, LivePrice>;
  updatedAt: number;
}

export interface Courier {
  name: string;
  /** Tracking link with {number} where the tracking number goes. */
  trackingUrl?: string;
}

export interface StorefrontSettings {
  priceBasis: Record<OrderType, 'po' | 'ots'>;
  graceMinutes: number;
  couriers: Courier[];
  /** Shown at the top of the storefront. */
  shopTitle?: string;
  shopIntro?: string;
  /** Payment instructions shown at checkout until a payment gateway exists. */
  paymentText?: string;
  /** Payment choices offered at checkout. */
  paymentChoices?: string[];
}

export const DEFAULT_STOREFRONT: StorefrontSettings = {
  priceBasis: { preorder: 'po', mail_order: 'ots' },
  graceMinutes: 60,
  shopTitle: 'Tsuchinoco shop',
  shopIntro: 'Preorder for our next event, or order by mail between events.',
  paymentText: 'Transfer the total to the account below and upload the receipt. We confirm every payment by hand.',
  paymentChoices: ['Bank transfer', 'QRIS'],
  couriers: [
    { name: 'JNE' },
    { name: 'J&T Express' },
    { name: 'SiCepat' },
    { name: 'Pos Indonesia' },
  ],
};

// ---- Storefront (public) ----

/** One orderable key of a product on the storefront, with the catalogue price at publish time as a fallback. */
export interface StoreVariant {
  key: string;
  name: string;
  thumb?: string;
  fallback: { po: number; ots: number; discountPercent?: number };
}

export interface StoreProduct {
  itemId: string;
  name: string;
  kind: ItemKind;
  type: string;
  category?: string;
  artist?: string;
  thumb?: string;
  variants: StoreVariant[];
}

/** A place a storefront order can go: an open preorder batch, or the mail-order channel. */
export interface StoreLaneInfo {
  /** publicForms document id: `store_<batchId>` or `store_mail`. */
  id: string;
  kind: OrderType;
  eventName: string;
  eventCode: string;
  startDate: string;
  endDate: string;
  pickupDays: string[];
  /** Last day preorders are taken, YYYY-MM-DD. */
  closesAt: string;
}

/** publicStore/catalog: everything the storefront shows. Public read, written by staff on publish. */
export interface StoreCatalog {
  title: string;
  intro: string;
  currency: string;
  products: StoreProduct[];
  lanes: StoreLaneInfo[];
  /** Event days, from the start of the first day to the end of the last: mail order pauses. */
  eventDays: { name: string; code: string; from: number; until: number }[];
  /** Staff-chosen sections and highlights come later; empty means group by item type. */
  sections: { title: string; keys: string[] }[];
  highlights: string[];
  paymentText: string;
  paymentChoices: string[];
  requirePhone: boolean;
  requireEmail: boolean;
  publishedAt: number;
  publishedHash: string;
  version: number;
}

/** publicStore/status: the mail-order switch. Public read. */
export interface StoreStatus {
  mailOrderOpen: boolean;
  /** "Open mail order anyway" until this time, even during an event or an open preorder. */
  overrideUntil?: number;
  updatedAt: number;
}

export interface Settings {
  currency: string;
  itemTypes: string[];
  pickupDeadlineDays: number;
  resendApiKey?: string;
  resendFromEmail?: string;
  resendFromName?: string;
  resendReplyTo?: string;
  emailTemplates?: EmailTemplate[];
  storefront?: StorefrontSettings;
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
  | 'status_change'
  | 'email_broadcast';

export type LogEntityType =
  | 'item'
  | 'price'
  | 'event'
  | 'batch'
  | 'order'
  | 'submission'
  | 'form'
  | 'staff'
  | 'settings'
  | 'movement'
  | 'wrapup'
  | 'email';

export interface EmailRecipient {
  id?: string;
  email: string;
  name?: string;
  batchId?: string;
  batchName?: string;
  orderId?: string;
  transactionId?: string;
  status?: string;
  fulfilment?: string;
  source: 'batch' | 'custom';
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface LogEntry {
  id: string;
  action: LogAction;
  entityType: LogEntityType;
  entityId?: string;
  entityName?: string;
  details: string;
  createdAt: number;
  createdBy: string;
  changes?: FieldChange[];
}

