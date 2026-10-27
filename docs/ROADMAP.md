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
