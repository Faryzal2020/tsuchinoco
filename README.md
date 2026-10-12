# Tsuchinoco Ops

Staff-only tool that replaces the circle's Google Sheets for the catalogue, stock, event preorders, production planning, and post-event wrap-up.

- **Catalogue** of items with variants and bundles, one product manager per item.
- **Stock** as a ledger of movements, with committed and available quantities across events.
- **Events** with numbered preorder batches. A batch defines what is on offer and has its own in-house preorder form, published as a public page; customer submissions become orders with a sequential ID (`CF23_1_0002`).
- **Orders** across upcoming events in one place, with import of new form submissions.
- **Forms** management: publish, link, accepting on or off, preview, per batch.
- **Planning** computes net units to order per variant from preorders, on-site extra, available stock, and incoming production.
- **Wrap-up** turns the post-event count into walk-in sales and stock movements, with bundle revenue handled.
- **Report** per event: revenue by channel, units produced, sold, left.

The full design is in [docs/DATA-MODEL.md](docs/DATA-MODEL.md). Deploying is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). What comes next, and why the project stays on the free Firebase plan for now, is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

| Layer | Choice |
| --- | --- |
| Web app | Next.js 15 (App Router, static export), React 19, TypeScript, Tailwind CSS 4 |
| Data | Cloud Firestore, read directly from the browser with offline persistence. Images are stored inline in Firestore until Cloud Storage is enabled. |
| Auth | Firebase Auth. Google sign-in for staff with an allowlist in the `staff` collection; anonymous sign-in for customers submitting the form |
| Server | None. Everything runs on the free Spark plan. `functions/` is the legacy JotForm integration and needs Blaze; see the roadmap. |
| Hosting | Firebase Hosting serving the static `out/` folder |

There is no backend API of our own. Firestore security rules allow any active staff member to read and write everything. Customers can read a published form snapshot and create one validated submission document; the staff app turns submissions into orders.

## Local development

```bash
cp env.template .env.local     # fill in the Firebase web app values
npm install
npm run dev                    # http://localhost:3000
```

The app talks to the real Firebase project named in `.env.local`. For the first sign-in to work, your Google email must exist as an active document in the `staff` collection (see the deployment guide, step 6).

To test the customer form end to end without touching the real project, run the local emulators (`firebase emulators:start --only auth,firestore`) with `NEXT_PUBLIC_USE_EMULATORS=1` in `.env.local`. See the deployment guide.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server with Turbopack |
| `npm run build` | Static export to `out/` |
| `npm run typecheck` | TypeScript check of the web app |
| `npm run lint` | ESLint |
| `npm run functions:build` | Compile the Cloud Functions to `functions/lib` |

## Project layout

```
src/
  app/                 Routes (static export, so ids live in the query string: /events/view/?id=…)
    layout.tsx         Fonts and global CSS only
    (staff)/           Staff app: providers, sign-in gate, top bar
      page.tsx         Orders (home)
      forms/           Forms management
      events/          List and event view with tabs
      catalog/         Items, item editor with thumbnails, CSV import
      stock/           Overview, stock take, movement ledger
      settings/        Staff allowlist, item types, defaults
    f/                 Public customer form, /f/?id=<batchId>, no sign-in gate
  components/
    ui/                Buttons, fields, pills, tables, dialogs, toasts
    event/             One component per event tab, plus order modals
    form/              FormRenderer (shared by the customer page and preview), ThumbnailInput
    AppShell.tsx       Sign-in gate, top bar, event switcher, "my items" toggle
    SubmissionImporter.tsx  Turns new submissions into orders while the app is open
  lib/
    firebase.ts        SDK init with offline cache
    auth.tsx           Auth state + staff allowlist check
    data.tsx           Live Firestore subscriptions (DataProvider), useEventOrders, useOrdersForEvents
    repo.ts            All Firestore writes, including forms, media, submissions, counters
    forms.ts           Default layout, publish snapshot, labels, theme
    importer.ts        Submission to order transaction
    media.ts           Browser-side image resizing and media cache
    compute.ts         Stock, planning, wrap-up, and report arithmetic (spec section 4)
    bundle.ts          Bundle price allocation and line expansion
    csv.ts, format.ts, keys.ts, prefs.tsx, useQuery.tsx
  types/index.ts       Domain types
functions/src/         Legacy JotForm integration (Blaze only), kept until removed
firestore.rules        Staff allowlist plus the two public rules for the form
firebase.json          Hosting, functions, emulators
docs/ROADMAP.md        Phases, deferred Blaze work, open questions
```

## Conventions

- Prices and totals are whole integers in the circle's currency (set in Settings).
- A variant is addressed everywhere as `itemId` + `variantId`; as a map key it is `itemId:variantId`. Items without variants use the hidden variant `default`.
- Stock movements are append-only. Undo is a reversal movement, never a delete.
- Orders store the price at order time. Changing an item's price never rewrites history.
- Order IDs follow `<eventcode>_<batchnumber>_<sequence>`, allocated from a per-batch counter in a transaction.
- Customers only ever read `publicForms` and create `submissions`. Everything else is staff-only.
- Every write goes through `src/lib/repo.ts` and stamps `updatedAt` / `updatedBy`.

## Design

Bright, cream-dominant interface with yellow and blue as minor accents. Buttons are tactile (solid border with a bottom shadow that compresses on press). Icons are avoided in favour of text labels. Tokens live at the top of `src/app/globals.css`.
