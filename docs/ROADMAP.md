# Roadmap

Status as of 2026-10-13. This file holds what is planned beyond the code that exists, and the reasons behind the order. Update it when a phase lands or a decision changes.

## Guiding constraint: Spark now, Blaze later

The Firebase project stays on the free Spark plan while the UI, UX, and data schema are iterated locally. Two Firebase products need the Blaze plan and are therefore deferred:

- **Cloud Functions.** Any runtime, any trigger. The `functions/` folder (JotForm form generation, webhook, re-import) cannot be deployed on Spark and is kept only as legacy until the JotForm path is removed.
- **Cloud Storage.** Projects created after October 2024 need Blaze even for the default bucket.

Everything in phases 1 and 2 runs with Firestore, Authentication, and Hosting only, both in the local emulators and on a Spark deployment. Phases 4 and 5 start once Blaze is enabled. Blaze has no monthly fee and includes the same free quotas, so the switch is a billing-account step, not a rewrite.

## Phase 1 — in-house form core (done in this commit)

- Thumbnails on catalogue items and variants, stored as small base64 images in the `media` collection (no Storage needed).
- One form per batch (`forms/{batchId}`), created from the batch offering with a default layout. The form is permanently tied to its batch and therefore to one event.
- Publish copies a self-contained snapshot to `publicForms/{batchId}`, the only collection a customer can read.
- Public customer page at `/f/?id=<batchId>`: themed, mobile-first, product cards with thumbnails and quantity steppers, customer details, pickup-or-mail with pickup day and address, notes, running total, confirmation code.
- Submissions are written by the customer directly to `submissions` under validation rules, using anonymous sign-in. No server.
- The staff app converts new submissions into orders (bundle expansion, prices from the offering, sequential ID `<eventcode>_<batch>_<seq>` from a per-batch counter). This runs whenever a staff member has the app open.
- **Orders** menu replaces Dashboard: all orders across upcoming events, filters, search, new-submission status, and the existing order detail modal.
- **Forms** menu: every form with event, batch, published state, accepting toggle, link copy, preview, and new-submission count.

## Phase 2 — form builder and templates (Implemented)

Goal: the same level of customization staff used in JotForm, scoped to what the circle actually uses.

- **Split-Screen Form Studio (`/forms/editor/?id=<batchId>`):** Real-time interactive preview beside the control panel, with a responsive viewport switch (Desktop vs. 390px Mobile phone frame) and payload size gauge relative to the 950 KB limit.
- **Block Editor:** Add, remove, reorder (move up/down), and customize individual form sections:
  - **Product Catalog:** Filter by category/type, bundles-only, all items, or hand-picked specific items; toggle between 2-column card Grid and compact List; toggle thumbnails and prices.
  - **Payment Instructions & QRIS:** Dedicated payment block supporting bank account details, transfer notes, and QRIS barcode image upload (placed immediately above the payment proof upload dropzone).
  - **Content Blocks:** Header banner (with top image upload), announcements/terms (Text), posters/maps (Image), Section headers, and Divider lines.
  - **Checkout Flow:** Customer info, Fulfilment options, Buyer notes, and Submit button.
- **Theme Studio:** 5 curated one-click presets (*Warm Cream*, *Midnight Cyber*, *Pastel Sakura*, *Clean Studio*, *Matcha Green*) plus custom overrides for background, surface card, accent, text colors, font style (sans, serif, rounded), layout width, and border radius.
- **Form Settings:** Custom pickup days manager (with 1-click reset to event dates), required phone and email flags, max quantity per line, thank-you message, and closed message.
- **Templates & Fast Clone:**
  - **1-Click Past Batch Clone:** Instantly clone layout, theme, payment instructions, and settings from any past event batch while preserving the current batch's offering.
  - **Template Library (`templates` collection):** Save any form design as a template, apply saved templates to any batch, set default template for new batches, and manage templates.
- **Publish & Change Tracking:** "Changed since publish" status indicator, version increments, and one-click republishing directly from the Form Studio, the Forms list, and the Event Batch tab.

## Phase 3 — JotForm import and removal

- One-off Node script run by a developer with the JotForm API key (never in the app): `GET /form/{id}`, `/properties`, `/questions`. It downloads product pictures and header images from the public `/uploads/` URLs, resizes them, writes `media` documents, attaches thumbnails to matching catalogue items by name, and writes a `formTemplates` document with the imported theme colours, header, and text blocks. Product names and image keys in the `control_payment` question are confirmed on the first dry run, since the public reference documents `icon` but not every key.
- Remove the `functions/` JotForm code, the `fx` wrapper, the JotForm settings panel, and the `provider: 'jotform'` branch once no live batch uses JotForm.
- Old JotForm orders stay in Firestore as they are (`source: 'jotform'`).

## Phase 4 — Blaze: Storage and uploads (Implemented)

- **Cloud Storage enabled.** `media` uploads are saved as Storage objects under `media/{id}`; `media` documents store metadata with a download URL. Public form snapshots reference URLs instead of inline base64 data, eliminating the per-form image budget constraint.
- **Media migration tool:** Settings now includes a status panel and one-click migrator to convert any legacy inline base64 images into Cloud Storage objects and update Firestore documents.
- **Payment proof upload on customer form:** Storage rules allow authenticated/anonymous customers to upload receipts (images/PDF up to 10 MB) directly to `submissions/{id}/`. Staff can view the receipt link in the order modal.
- **Higher resolution images:** Thumbnail size cap raised to 480 px and header image size cap to 1600 px for crisp retina displays.
- **Storage security rules:** Deployed via `storage.rules` with cross-service Firestore staff verification.

## Phase 5 — Blaze: invoices and email

- Invoice generator: a printable HTML invoice per order (circle name, order ID, lines, total, payment instructions), exported to PDF in the browser. Template fields editable in Settings.
- Email: subject and body templates with placeholders (`{{name}}`, `{{orderId}}`, `{{total}}`, `{{pickupDay}}`), one email per order with the invoice attached, "sent" status and timestamp on the order, bulk send for a batch, resend.
- Transport options, in order of preference: a Cloud Function using a transactional mail API or SMTP (needs Blaze, which this phase assumes); or client-side Gmail API using the staff member's Google sign-in with the `gmail.send` scope, which needs no server but requires the OAuth app to list staff as test users.
- Optional with Functions: a Firestore trigger that imports submissions into orders server-side, so orders exist even when no staff member has the app open, and a webhook-free replacement for JotForm's email notifications.

## Storefront phase A — orders and prices (built 2026-11-04, branch claude/storefront-phase-a)

Order type, payment and tracking on every order; Orders page opens on Unfulfilled with tabs per order type; price history, live price list and percentage discount; enforced batch dates. See the storefront section of `docs/DATA-MODEL.md`. Phase B (the `/shop/` page and the standing mail-order channel) and phase C (server-side import, order-update e-mails) follow.

## Storefront phase B — the shop page (built 2026-11-04, branch claude/storefront-phase-b)

`/shop/` with search, filters, cart and checkout; staff Storefront page (state and reasons, mail-order switch and override, listed preorders, shop text, publish); standing mail-order channel with monthly batches; login-free `/sandbox/` for localhost. Phase C next: server-side import and order-update e-mails.

## Storefront phase C — server import and order e-mails (built 2026-11-04, branch claude/storefront-phase-c)

Submissions become orders on the server within seconds; the browser importer is a 2-minute fallback. Order-update e-mails (received, paid, delivered with tracking) with switches and templates in Settings, a skip checkbox in the Delivered dialog, an e-mail log and "Send again" on each order.

## Mail phase — shared inbox and send queue (built 2026-11-05, uncommitted)

Staff read and answer customer e-mail on the Emails page (Inbox tab) instead of a separate mailbox. Every e-mail the app sends goes through one queue that keeps to Resend's free-plan limits: staff replies, broadcasts and order updates. The data model is in the "Mail" section of `docs/DATA-MODEL.md`. The localhost sandbox has it at `/sandbox/emails/`, and the shop's contact form at `/sandbox/shop/` files into it.

**Decisions (2026-11-05)**

- **One shared inbox, one communication address: `admin@tsuchinoco.xyz`.** Every active staff member sees all mail sent and received. `admin@` is the only Resend inbox (the free plan allows 3) and the only address staff send and receive through; there are no per-staff addresses. Each message records which staff member sent it.
- **`orders@` sends automated mail** (order updates now, more notifications later). It replaces the earlier `noreply@` and `system@`. It has no inbox and always carries `Reply-To: admin@`. Mail sent straight to it is not received. The other 2 free inboxes stay unused for now.
- **Replies are signed.** Each staff member sets a signature on the Settings page; it goes under every reply they send.
- **No two staff answer the same thread at once.** While someone writes a reply, the thread shows "Rina is replying". Sending warns if a new message arrived, or someone else is replying, since the reply box was opened.
- **Folders:** Inbox, Outbox (waiting), Sent, Failed (refused, bounced, complained), Spam, Archive. Spam holds blocked senders and whatever Resend's own filter marks as spam. Each move to Spam or Failed shows its reason.
- **A contact form on `/shop/`** files messages straight into the Inbox with no e-mail, so they use none of the quota. `admin@` is not printed on any public page.
- **Free plan** (100 e-mails a day, 3,000 a month; received mail counts too). Sends past the budget wait in the Outbox and go out after the UTC midnight reset (07:00 WIB). Priority order: staff mail, then order updates, then broadcasts.

**How it works**

- **Resend Inboxes keeps the threads.** Mail to `admin@` arrives through the `inbox.email.received` webhook. Staff replies go out through the inbox reply API, which sets `In-Reply-To` and `References` itself. A new message, or the first reply to a contact-form message, goes out as an inbox draft. No custom `Message-ID` is needed.
- **Copies stay with us.** Resend deletes received mail after 30 days, so the webhook copies each message into Firestore and its attachments into Storage.
- **The queue** sends staff and order messages the moment they are queued while the budget lasts. Broadcasts are sent by `queueBroadcast` itself, in batches of up to 100. Whatever is left waits for `drainMailQueue`, which runs every 15 minutes. The broadcast confirmation shows how many go out now and when the rest follow.
- **Mail bodies** are shown in a sandboxed frame: scripts never run, and remote images stay hidden until "Load images". Each thread shows the orders placed with the sender's address, and "Open in Orders" searches the Orders page for that address.
- **Removed:** the browser's direct calls to Resend from the old broadcast page, and the `sendBroadcastEmail` function.

**Added the same day:** a picker for the inboxes set up in Resend (`admin@`, `support@`, `jknor@`), each with its own folders and unread count. Inbox names are set in Mail settings and saved in Resend, where they are also the From name. Replies go out from the thread's inbox. New messages and replies can carry Cc, Bcc and attachments. Attachments are up to 10 files and 20 MB in all, uploaded to Storage first. Broadcasts have no attachments: Resend's batch endpoint does not take them. The Inbox fills the window on desktop, with independently scrolling columns.

**Setup before going live (by hand)**

1. Resend › Domains › `tsuchinoco.xyz`: turn on receiving and add the MX record it shows at Rumahweb on the root host. The domain has no MX record today, so nothing conflicts.
2. Resend › Inboxes: create the `admin@tsuchinoco.xyz` inbox, with "Tsuchinoco" as its From name. Replies use the inbox's From name.
3. Resend › Webhooks: add `https://asia-southeast1-<project-id>.cloudfunctions.net/mailWebhook` with these events:
   - `inbox.email.received`, `inbox.email.sent`, `inbox.thread.folder_updated`
   - `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`

   Put its signing secret in `functions/.env` as `RESEND_WEBHOOK_SECRET`.
4. Deploy `firestore.rules`, `firestore.indexes.json` and `storage.rules` first, then the functions, then hosting. The deploy will offer to delete `sendBroadcastEmail`; accept. Wait for the new indexes to finish building before using the Inbox.
5. Check the Mail settings modal on the Emails page (sender name, addresses, limits, API key). Each staff member sets their signature in Settings.
6. Later, once sending looks clean, tighten DMARC from the current `p=none`.

**Not yet verified against live Resend** (check with the first real messages)

- That `resend.emails.receiving.attachments.list` accepts an inbox e-mail's id. If it does not, attachments show as "not saved" and need the inbox attachment endpoint instead.
- That inbox replies and drafts fire `email.*` delivery events with the same id the send returned. Until they do, those messages stay at "Sent" rather than "Delivered".
- Whether received mail really counts against the 100-a-day cap, and what Resend does with inbound mail once the cap is reached.
- That Resend's daily quota resets at UTC midnight, and the exact quota error names (the queue handles `daily_quota_exceeded` and `monthly_quota_exceeded`).
- The inbox's From name on replies, which is set in Resend rather than in the app.

**Limits to keep in mind**

- The Inbox lists the latest 300 threads and the latest 300 outgoing messages; older ones stay in Firestore but are not shown.
- A broadcast is limited to 3,000 recipients, and the server only gets about 4 minutes per run to send what the budget allows; the rest follows on the 15-minute runs.

## Shipping phase — Lion Parcel prices at checkout (planned 2026-11-11)

Shipping is charged at checkout through Biteship (courier `lion`), locked in, and paid together
with the items in one transfer: no second invoice or e-mail for shipping. Probe scripts and test
results are in `scripts/shipping/`.

**Rules agreed with the circle**

- Lion Parcel only for now: `reg_pack` (REGPACK) and `boss_pack` (BOSSPACK). Ships from
  Bojonggede, Bogor (postcode 16920; a setting, so it can move).
- The customer types a destination postcode; no paid place search.
- Weight = sum of item weights + a fixed 100 g packing. Lion bills whole kg: a remainder above
  0.3 kg rounds up (1,300 g → 1 kg, 1,310 g → 2 kg).
- Shipped orders also pay a handling fee (default Rp10.000) and a packaging fee (default Rp5.000),
  set in storefront settings and per form in form settings. Booth pickups pay neither.
- The % discount applies to items only, never to shipping or fees.
- Earliest ship date: event preorders at least 14 days after the event ends; mail orders at least
  14 days after payment, and at least 14 days after the end of any event they wait for, whichever
  is later. Checkout states the rule; staff see the date in the Unfulfilled view.
- Google sign-in is required whenever the order ships (mail orders, and preorders that choose
  shipping). Booth-pickup preorders keep the anonymous sign-in.
- Customers see their orders: signed-in customers get an order history page; every order also
  has a private link (anyone with it can open that one order), sent in the "Payment confirmed"
  e-mail. The page shows status, payment and, once shipped, courier, tracking number and link.

**Customer flow after choosing items**

1. Cart → Checkout (order type already set by the lane).
2. Details: name, e-mail, phone. Choosing shipping asks for Google sign-in first and fills in the
   name and e-mail from the account.
3. Pick up or ship (preorders) / ship (mail orders).
4. Shipping: postcode → Lion options appear with price and days, plus "charged as N kg". The
   customer picks one, then writes the full address. Shown under it: when it ships (the 14-day rule).
5. Summary: items, shipping (Lion REGPACK), handling, packaging, total. Quantity changes re-quote
   only when the billed kg changes.
6. Payment and receipt as today; place order; confirmation and "received" e-mail show the breakdown.
7. Staff confirm payment → "Payment confirmed" e-mail with the private order link → staff ship and
   add tracking → "Delivered" e-mail. The order page follows each step.

**Build steps**

S1. Data and settings (built 2026-11-11, uncommitted)
- `weightGrams` on items, optional per-variant override; bundles sum their components unless set.
  Published into `publicStore/catalog` and `publicForms`. Publishing warns about offered items
  without a weight; a missing weight counts as 100 g and flags the order.
- `StorefrontSettings.shipping` and `FormSettings`: `handlingFee`, `packagingFee`, origin postcode.
- `BITESHIP_KEY` as a Functions secret (`firebase functions:secrets:set BITESHIP_KEY`).
- Built: `src/lib/shipping.ts` (weights, billed kg, fees), weight fields in the item editor, a
  Shipping tab on the Storefront page (origin, fees, items without a weight), fee overrides in
  form settings, weights and resolved fees in every published form and lane, and a publish
  warning in the form editor and on the Storefront page. The secret moves to S2. After deploy,
  every published form shows "changed since publish" once (the hash now covers weights and fees):
  republish the forms and the storefront so customers' pages carry them.

S2. `quoteShipping` callable (asia-southeast1) (built 2026-11-11, uncommitted, not deployed)
- Input: postcode, cart lines, form id. The server computes weight from the catalogue; the page's
  numbers are never trusted. Requires a Google-signed-in caller; about 20 quotes per user per hour.
- Calls Biteship rates by postcode (Rp5 per call on the live key) and caches in `shippingQuotes`
  keyed by postcode + billed kg for 24 hours. Each answer gets a `quoteId` storing options and fees.

- Built in `functions/src/shipping.ts`. Weights and fees come from the published form (what
  the customer saw), not the live catalogue. Collections, all server-only: `shippingQuotes`
  (one per quote, 24 h), `shippingRates` (price per origin, postcode and billed kg, 24 h) and
  `shippingLimits` (30 quotes per user per hour; 1,000 Biteship calls per Jakarta day, about
  Rp5.000). Lion services offered: REGPACK and BOSSPACK; a postcode Lion does not serve gives no
  options. The sandbox fakes it (`fx.quoteShipping`; postcode 99999 has no delivery).
- Before deploying: `firebase functions:secrets:set BITESHIP_KEY` with the live key. Deploy
  together with S3, since nothing calls it before then.

S3. Checkout on the shop and on Forms (one shared shipping picker) (built 2026-11-11, uncommitted, not deployed)
- Shop `Checkout` in `src/components/shop/Shop.tsx` and the `fulfilment` block in
  `src/components/form/FormRenderer.tsx`.
- Submissions gain `postalCode`, `shipping: { quoteId, service }` and `customerUid`.
  `validSubmission()` allows them and, for `fulfilment == 'mail'`, requires
  `sign_in_provider == 'google.com'` and `customerUid == request.auth.uid`. Deploy the rules
  before hosting, as in phase A.

- Built: `src/lib/shippingQuote.ts` (quote state shared by both pages), `src/lib/customerAuth.ts`
  (Google sign-in on the public pages), the shipping section in the shop `Checkout` and in
  `FormRenderer` (fulfilment block, and the customer block on post-event forms, which until now
  had no address field), the shipping lines in totals and on the thank-you screens, and the rules
  (`validShipping`). The sandbox has a new `/sandbox/form/` page with a fake sign-in.
- Deploy rules, functions and hosting together: the new rules refuse anonymous mail orders and
  the old rules refuse the new fields. Set the `BITESHIP_KEY` secret first, and check that
  tsuchinoco.xyz is an authorised domain for Google sign-in in Firebase Authentication.
- Until S4, the import ignores the shipping fields: orders are created without the shipping
  charge in their total.

S4. Import and staff side (built 2026-11-11, uncommitted, not deployed)
- `buildImportedOrder` reads the quote: same postcode and same billed kg → `order.shipping =
  { courier, service, fee, handlingFee, packagingFee, weightGrams, billedKg, postalCode, quotedAt }`
  and `total` includes them. A missing or expired quote is re-quoted on the server; if that fails
  the order gets `shippingFlag` ("confirm shipping with the customer"), like `priceFlag`.
- Earliest ship date stored on the order; Unfulfilled view sorts and shows it.
- Order view shows the shipping lines; staff can override a fee with a note. E-mail templates get
  `{shipping}`, `{fees}` and `{orderLink}`.

- Built: `resolveShipping` in `src/lib/shipping.ts` checks a submission against its quote (same
  customer, form, postcode and billed kg, the chosen service offered, submitted before expiry).
  The server import (`shippingForSubmission` in `functions/src/shipping.ts`) charges a fitting
  quote and otherwise re-prices through the cached Biteship rates, flagging the order when the
  amount may differ from what the customer saw; the staff-browser fallback import cannot re-price
  and flags instead. Orders carry `shipping`, `shippingFlag` and `customerUid`; `total` includes
  shipping, handling and packaging.
- Staff: the order view shows the shipping lines, a "Shipping checked" flag box and a Change /
  Add shipping editor (a note is required; the total moves by the difference). The Orders list
  shows "Ships from" (`shipFromOf` in `src/lib/orders.ts`), sorts by it, lists shipping flags
  under "Price or shipping to check", and exports shipping and postcode. Deliver pre-fills
  Lion Parcel. Order e-mails put shipping rows in `{{items}}` and gain `{{itemsTotal}}`,
  `{{shipping}}`, `{{shippingFee}}`, `{{handlingFee}}` and `{{packagingFee}}`.
- Fixed along the way: `src/lib/store.ts` imported values from `@/types`, which the compiled
  functions cannot resolve (added 2026-11-09, after the last functions deploy); it now imports
  `../types`, so the next functions deploy loads.

S5. Customer order pages (built 2026-11-12, uncommitted, not deployed)
- A function mirrors each order into `customerOrders/{token}` (random 128-bit token) with only
  what the customer may see: code, status, payment, lines, shipping, total, tracking, `uid`.
- Rules: `get` by anyone (the token is the secret), `list` only where `uid == request.auth.uid`.
- `/shop/orders/` (history, Google sign-in) and `/shop/order/?t=<token>` (private link; query
  parameter because the site is a static export).

- Built: `customerOrderView` in `src/lib/customerOrders.ts`; `functions/src/customerOrders.ts`
  (`ensureCustomerToken`, the `mirrorCustomerOrder` trigger, which skips writes when only staff
  data changed); `customerOrders` rules (get by token, list own uid); `/shop/order/?t=` and
  `/shop/orders/` with `CustomerOrderCard` and `CustomerOrderHistory`; a "My orders" link on
  the shop; `{{orderLink}}` and `{{orderUrl}}` in order e-mails, added to the built-in "Payment
  confirmed" and "Delivered" templates (custom templates need the placeholder added by staff).
  The e-mail queue gives an order its token before rendering. Sandbox: `/sandbox/my-orders/`.
- Orders placed before S5 get a token and a customer copy on their next change.

**Deploying the shipping phase** (all at once, from a clean build):
1. `firebase functions:secrets:set BITESHIP_KEY` with the live key.
2. Firebase Authentication: Google enabled (it is, for staff) and `tsuchinoco.xyz` in the
   authorised domains.
3. `firebase deploy --only firestore:rules,functions,hosting`.
4. Republish the storefront and every open form, so customer pages carry weights and fees.
5. Add weights to the catalogue (Storefront → Shipping lists what is missing) and add
   "Lion Parcel" to the couriers in Settings.

**Later**: book the pickup through Biteship's order API so the waybill lands on the order and
triggers the "Delivered" e-mail. It spends courier balance, so it is a separate decision.

## Later and undecided

- Customer-choice bundles ("any 3 keychains") on the form. Needs a decision on the data model first.
- Spam protection stronger than anonymous sign-in plus honeypot: Firebase App Check with reCAPTCHA v3. Verify it is available on the current plan before relying on it.
- Customer self-service: a link to view or edit a submission before the batch closes.
- Catalogue list and offering picker showing thumbnails.
- Automatic Firestore backups (Blaze: scheduled exports).

## Phase 1 limits to keep in mind

- A Firestore document is at most 1 MiB. The public form snapshot inlines every thumbnail, so a form carries roughly 700 KB of images at most. Thumbnails are resized to 240 px and header images to 1200 px before saving; publish refuses a snapshot above the limit and says which images to shrink.
- Spark quota is 50,000 document reads per day. A customer load costs one read of the public form plus one anonymous sign-in at submit time, which leaves ample headroom for a launch day.
- Submission processing happens in the staff browser. Until someone opens the app, new submissions sit in `submissions` with status `new`. Committed stock and planning only see them after import.
- No file upload (payment proof) until phase 4. Customers send proof through the usual chat channel for now.
- Local emulators need Java 11+ and `firebase-tools` installed; neither is on the development machine yet.
