# Tsuchinoco Ops

Staff-only tool that replaces the circle's Google Sheets for the catalogue, stock, event preorders, production planning, and post-event wrap-up.

- **Catalogue** of items with variants and bundles, one product manager per item.
- **Stock** as a ledger of movements, with committed and available quantities across events.
- **Events** with numbered preorder batches. A batch defines what is on offer and generates its own JotForm; submissions arrive automatically as orders.
- **Planning** computes net units to order per variant from preorders, on-site extra, available stock, and incoming production.
- **Wrap-up** turns the post-event count into walk-in sales and stock movements, with bundle revenue handled.
- **Report** per event: revenue by channel, units produced, sold, left.

The full design is in [docs/DATA-MODEL.md](docs/DATA-MODEL.md). Deploying is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Stack

| Layer | Choice |
| --- | --- |
| Web app | Next.js 15 (App Router, static export), React 19, TypeScript, Tailwind CSS 4 |
| Data | Cloud Firestore, read directly from the browser with offline persistence |
| Auth | Firebase Auth, Google sign-in, allowlist in the `staff` collection |
| Server | Cloud Functions v2 (Node 20) for JotForm form generation and submission import |
| Hosting | Firebase Hosting serving the static `out/` folder |

There is no backend API of our own. Firestore security rules allow any active staff member to read and write everything; the functions exist only because JotForm needs a server-side API key and a webhook target.

## Local development

```bash
cp env.template .env.local     # fill in the Firebase web app values
npm install
npm run dev                    # http://localhost:3000
```

The app talks to the real Firebase project named in `.env.local`. For the first sign-in to work, your Google email must exist as an active document in the `staff` collection (see the deployment guide, step 6).

JotForm features (generate form, re-sync, re-import, test connection) call deployed Cloud Functions. They need the functions deployed with the `JOTFORM_API_KEY` secret, or the functions emulator running with that secret set locally.

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
    page.tsx           Dashboard
    events/            List and event view with tabs
    catalog/           Items, item editor, CSV import
    stock/             Overview, stock take, movement ledger
    settings/          Staff allowlist, item types, defaults, JotForm check
  components/
    ui/                Buttons, fields, pills, tables, dialogs, toasts
    event/             One component per event tab, plus order modals
    AppShell.tsx       Sign-in gate, top bar, event switcher, "my items" toggle
  lib/
    firebase.ts        SDK init with offline cache
    auth.tsx           Auth state + staff allowlist check
    data.tsx           Live Firestore subscriptions (DataProvider) and useEventOrders
    repo.ts            All Firestore writes
    compute.ts         Stock, planning, wrap-up, and report arithmetic (spec section 4)
    bundle.ts          Bundle price allocation and line expansion
    csv.ts, format.ts, keys.ts, prefs.tsx, useQuery.tsx
  types/index.ts       Domain types
functions/src/
  index.ts             Callables (generateForm, syncForm, setFormStatus, reimportBatch, jotformStatus) and the webhook
  jotform.ts           Minimal JotForm REST client
  bundle.ts            Copy of the allocation rules for server-side import
firestore.rules        Single staff-allowlist rule
firebase.json          Hosting, functions, emulators
```

## Conventions

- Prices and totals are whole integers in the circle's currency (set in Settings).
- A variant is addressed everywhere as `itemId` + `variantId`; as a map key it is `itemId:variantId`. Items without variants use the hidden variant `default`.
- Stock movements are append-only. Undo is a reversal movement, never a delete.
- Orders store the price at order time. Changing an item's price never rewrites history.
- Every write goes through `src/lib/repo.ts` and stamps `updatedAt` / `updatedBy`.

## Design

Bright, cream-dominant interface with yellow and blue as minor accents. Buttons are tactile (solid border with a bottom shadow that compresses on press). Icons are avoided in favour of text labels. Tokens live at the top of `src/app/globals.css`.
