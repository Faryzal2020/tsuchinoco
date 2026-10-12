# Deployment guide

Everything needed to take the project from a fresh clone to a working deployment, including the parts that must be done by hand in the Firebase console.

The current Firebase project id is in `.firebaserc` (`tsuchinoco-318b2`). Replace it if you deploy to a different project.

## Plan requirements

The app is built so that everything needed to run the preorder form, orders, stock, planning, and wrap-up works on the **free Spark plan**: Firestore, Authentication, and Hosting. Nothing in the main app calls a Cloud Function.

Two things need the **Blaze plan** and are deferred (see `docs/ROADMAP.md`):

- Cloud Functions, used only by the legacy JotForm integration in `functions/`. Do not deploy it on Spark; the deploy fails.
- Cloud Storage, for payment-proof uploads and larger images.

## Prerequisites

- Node.js 20 or newer and npm.
- Firebase CLI: `npm install -g firebase-tools`, then `firebase login`.
- Java 11 or newer, only for the local emulators.
- A Google account that will become the first staff member.

## 1. Firebase project

In the [Firebase console](https://console.firebase.google.com/):

1. Create a project, or open the existing one. Stay on the Spark plan for now.
2. Under **Project settings → General → Your apps**, add a **Web app**. Do not enable Firebase Hosting from this dialog, it is configured by `firebase.json`. Copy the `firebaseConfig` values; they go into `.env.local` (step 5) and into the hosting build.

## 2. Authentication

**Build → Authentication → Get started.**

1. **Sign-in method → Add new provider → Google.** Enable it. Set a support email. Save. This is the staff sign-in.
2. **Sign-in method → Add new provider → Anonymous.** Enable it. The public preorder form signs customers in anonymously right before they submit, so that the security rules can require a signed-in user. No customer account is ever created.
3. **Settings → Authorized domains.** `localhost` and the `*.web.app` / `*.firebaseapp.com` domains are added automatically. Add any custom domain you attach later.

There are no roles; staff access is decided by the `staff` collection.

## 3. Firestore

**Build → Firestore Database → Create database.**

1. Choose a region close to the team. `asia-southeast1` (Singapore) or `asia-southeast2` (Jakarta) are the usual choices. The region cannot be changed later.
2. Start in **production mode**. The rules in the repo replace the defaults on first deploy.

Firestore offline persistence is enabled in the app, so no console setting is needed for that.

## 4. First staff member (manual, once)

The security rules only admit emails that exist in the `staff` collection, so the very first document has to be created by hand.

**Firestore Database → Data → Start collection:**

- Collection ID: `staff`
- Document ID: your Google email, **lower-case** (for example `name@gmail.com`)
- Fields:

| Field | Type | Value |
| --- | --- | --- |
| `email` | string | same as the document id |
| `displayName` | string | your name |
| `active` | boolean | `true` |
| `createdAt` | number | any number, e.g. `0` |
| `updatedAt` | number | any number, e.g. `0` |
| `updatedBy` | string | `console` |

After this one document, everyone else is added from **Settings → Staff** inside the app.

## 5. Environment file

```bash
cp env.template .env.local
```

Fill in the six `NEXT_PUBLIC_FIREBASE_*` values from step 1. `.env.local` is git-ignored. For CI builds, provide the same variables as environment variables. `NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION` only matters for the legacy JotForm functions.

## 6. Deploy (Spark)

From the repo root:

```bash
npm install
```

Deploy the rules first, then hosting.

```bash
firebase deploy --only firestore
```

```bash
npm run build
```

```bash
firebase deploy --only hosting
```

Do **not** run a bare `firebase deploy` on the Spark plan: it tries to deploy `functions/` and fails.

The site is served at `https://<project-id>.web.app`. The public preorder form of a batch is `https://<project-id>.web.app/f/?id=<batchId>`; the staff app shows and copies this link.

### What each deploy target does

| Target | Source | Notes |
| --- | --- | --- |
| `firestore` | `firestore.rules`, `firestore.indexes.json` | The rules file is the whole access model, including the two public exceptions for the form. |
| `hosting` | `out/` | Produced by `npm run build`. `trailingSlash` is on, so every page is a folder with an `index.html`. The customer page `/f/` is part of the same build. |
| `functions` | `functions/` | Legacy JotForm integration. Blaze only. |

## 7. Verify

1. Open the site and sign in with the Google account from step 4. You land on **Orders**.
2. Catalogue: add a test item and give it a thumbnail.
3. Events: create an event with a code (for example `TEST`), add batch 1, pick the item in the offering, **Create form**, then **Publish**. Open the form link in a private window.
4. Submit the form once. Back in the staff app, Orders shows the submission being imported and then the order with an ID like `TEST_1_0001`.
5. Delete the test item and event afterwards, or keep the event and cancel the test order.

## 8. Day-to-day operations

- **Adding staff:** Settings → Staff → Add. Deactivate instead of deleting so names stay on history.
- **Changing the offering or layout after publishing:** edit, then **Publish** again on the batch card or Forms page. Customers see the new version on their next load.
- **Stopping submissions:** close the batch, or flip **Accepting** on the Forms page.
- **Submissions that did not become orders:** Orders shows them under "New submissions" with the reason. Import runs automatically while the app is open; use **Import now** after fixing the cause.
- **Backups:** Firestore has no automatic backups on the free tier. Export CSVs from the app before and after each event. Scheduled exports need Blaze.

## Local emulators

Needs Java and `firebase-tools` installed.

```bash
firebase emulators:start --only auth,firestore,hosting
```

To point the web app at the emulators, add to `.env.local`:

```
NEXT_PUBLIC_USE_EMULATORS=1
```

`src/lib/firebase.ts` then connects Firestore and Auth to the emulator ports in `firebase.json`. The emulated Firestore starts empty, so create the first `staff` document in the emulator UI (http://localhost:4000) just as in step 4. The Auth emulator accepts anonymous sign-in without any setup.

Run the Next.js dev server separately with `npm run dev`; the customer page is then `http://localhost:3000/f/?id=<batchId>`.

## Moving to Blaze later

1. Upgrade the project in the console (Billing → Modify plan). Set a budget alert.
2. Storage: **Build → Storage → Get started**, then follow the phase 4 notes in `docs/ROADMAP.md`.
3. Functions: `npm --prefix functions install`, then `firebase deploy --only functions`. The first deploy takes several minutes while Google enables Cloud Build, Artifact Registry, and Eventarc. Only needed if the legacy JotForm path or the planned server-side features are wanted.

## Legacy: JotForm functions

Kept for reference until the JotForm path is removed. Requires Blaze.

1. JotForm: **avatar → Settings → API → Create New Key** with **Full Access**.
2. Store it as a secret: `firebase functions:secrets:set JOTFORM_API_KEY`. EU accounts set `JOTFORM_API_BASE=https://eu-api.jotform.com` at deploy time.
3. `firebase deploy --only functions`. The webhook URL is `https://asia-southeast1-<project-id>.cloudfunctions.net/jotformWebhook`.
4. Settings → JotForm connection → **Test connection** reports the connected username.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Firebase is not configured" screen | `.env.local` missing or values blank | Step 5, then restart `npm run dev` |
| "Not on the staff list" after sign-in | No active `staff/<email>` document, or email case mismatch | Step 4; the document id must be lower-case |
| Sign-in popup blocked or `auth/unauthorized-domain` | Domain not in Authorized domains | Step 2 |
| Customer form says "could not submit" with `permission-denied` | Anonymous provider not enabled, rules not deployed, or the public form is disabled | Step 2.2, `firebase deploy --only firestore`, check Accepting on the Forms page |
| Customer form shows "Form not found" | Not published yet, or wrong id in the link | Publish from the batch card or Forms page |
| Publish fails with "too large" | Too many or too big images for one Firestore document | Replace big thumbnails; the message names the heaviest ones |
| Orders do not appear after a customer submits | No staff member has the app open; import runs in the browser | Open Orders; use Import now |
| `firebase deploy` fails mentioning functions or Blaze | Bare deploy on the Spark plan | Use `--only firestore` and `--only hosting` |
