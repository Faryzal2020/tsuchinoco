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

## Phase 2 — form builder and templates

Goal: the same level of customization staff used in JotForm, scoped to what the circle actually uses.

- Block editor on the form page: add, remove, reorder (drag or move buttons), and edit blocks: header (title, subtitle, image), text, image, divider, section, products (source by item type, bundles, or hand-picked entries; list or grid; thumbnails on or off; show prices), customer details, fulfilment, notes, submit button label.
- Theme editor: background, surface, accent, text colour, font family, width, corner radius. Live preview beside the editor.
- Labels editor for every customer-facing string (bilingual defaults already exist in phase 1).
- Pickup days editor (defaults to the event dates).
- Settings: max quantity per line, required phone or email, thank-you and closed messages.
- Templates in `formTemplates`: save any form as a template (theme, blocks with unresolved product sources, labels, settings), apply a template to an existing form without touching its offering, pick a template when creating a form, mark one as default.
- Duplicate layout from another event's form in one click.
- Preview from the editor at any time, including unpublished changes.
- "Changed since publish" indicator and one-click republish.

## Phase 3 — JotForm import and removal

- One-off Node script run by a developer with the JotForm API key (never in the app): `GET /form/{id}`, `/properties`, `/questions`. It downloads product pictures and header images from the public `/uploads/` URLs, resizes them, writes `media` documents, attaches thumbnails to matching catalogue items by name, and writes a `formTemplates` document with the imported theme colours, header, and text blocks. Product names and image keys in the `control_payment` question are confirmed on the first dry run, since the public reference documents `icon` but not every key.
- Remove the `functions/` JotForm code, the `fx` wrapper, the JotForm settings panel, and the `provider: 'jotform'` branch once no live batch uses JotForm.
- Old JotForm orders stay in Firestore as they are (`source: 'jotform'`).

## Phase 4 — Blaze: Storage and uploads

- Enable Cloud Storage. Migrate `media` documents to Storage objects; keep the `media` document as metadata with a download URL. The public form snapshot then references URLs instead of inline data, lifting the per-form image budget.
- Payment proof upload on the customer form (the live JotForm had this). Storage rules allow unauthenticated or anonymous create into `submissions/{id}/` with size and type limits; staff read. The order gains `paymentProofUrl`, already present in the type.
- Larger images for the header and products.

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
