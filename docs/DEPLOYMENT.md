# Deployment guide

Everything needed to take the project from a fresh clone to a working deployment, including the parts that must be done by hand in the Firebase console and in JotForm.

The current Firebase project id is in `.firebaserc` (`tsuchinoco-318b2`). Replace it if you deploy to a different project.

## Prerequisites

- Node.js 20 or newer and npm.
- Firebase CLI: `npm install -g firebase-tools`, then `firebase login`.
- Java 11 or newer, only if you want to run the local emulators.
- A Google account that will become the first staff member.
- A JotForm account with API access (any plan, including free, can create API keys).

## 1. Firebase project

In the [Firebase console](https://console.firebase.google.com/):

1. Create a project, or open the existing one. Name does not matter.
2. **Upgrade to the Blaze (pay as you go) plan.** Cloud Functions v2 require it. Usage for a tool this size stays inside the free quota, but the plan must be Blaze.
3. Under **Project settings → General → Your apps**, add a **Web app**. Do not enable Firebase Hosting from this dialog, it is configured by `firebase.json`. Copy the `firebaseConfig` values; they go into `.env.local` (step 7) and into the hosting build.

## 2. Authentication

**Build → Authentication → Get started.**

1. **Sign-in method → Add new provider → Google.** Enable it. Set a support email. Save.
2. **Settings → Authorized domains.** `localhost` and the `*.web.app` / `*.firebaseapp.com` domains are added automatically. Add any custom domain you attach later.

Nothing else. There are no roles; access is decided by the `staff` collection.

## 3. Firestore

**Build → Firestore Database → Create database.**

1. Choose a region close to the team. `asia-southeast1` (Singapore) or `asia-southeast2` (Jakarta) are the usual choices. The region cannot be changed later.
2. Start in **production mode**. The rules in the repo replace the defaults on first deploy.

Firestore offline persistence is enabled in the app, so no console setting is needed for that.

## 4. Cloud Functions region

The functions deploy to `asia-southeast1` by default. This is set in two places that must agree:

- `functions/src/index.ts`: `const REGION = 'asia-southeast1'`
- `.env.local` and the hosting build: `NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION=asia-southeast1`

Change both if you want a different region.

## 5. JotForm API key and secret

1. In JotForm: **avatar → Settings → API → Create New Key.** Permission must be **Full Access** (the functions create forms and register webhooks). Copy the key.
2. If the account is on JotForm EU, the API base is `https://eu-api.jotform.com`. Set it as a parameter at deploy time (the CLI prompts for `JOTFORM_API_BASE`) or accept the default `https://api.jotform.com`.
3. Store the key as a Cloud Functions secret:

```bash
firebase functions:secrets:set JOTFORM_API_KEY
```

Paste the key when prompted. To rotate it later, run the same command and redeploy the functions.

The key is never stored in Firestore or in the web bundle. Settings → JotForm connection → **Test connection** calls a function that uses the secret and reports the connected username.

## 6. First staff member (manual, once)

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

## 7. Environment file

```bash
cp env.template .env.local
```

Fill in the six `NEXT_PUBLIC_FIREBASE_*` values from step 1 and keep `NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION` in sync with step 4. `.env.local` is git-ignored. For CI builds, provide the same variables as environment variables.

## 8. Deploy

From the repo root:

```bash
npm install
npm --prefix functions install
```

Deploy the rules first, then functions, then hosting. The first functions deploy takes several minutes while Google enables Cloud Build, Artifact Registry, and Eventarc.

```bash
firebase deploy --only firestore
```

```bash
firebase deploy --only functions
```

```bash
npm run build
```

```bash
firebase deploy --only hosting
```

Or everything at once:

```bash
npm run build && firebase deploy
```

The site is served at `https://<project-id>.web.app`.

### What each deploy target does

| Target | Source | Notes |
| --- | --- | --- |
| `firestore` | `firestore.rules`, `firestore.indexes.json` | The rules file is the whole access model. No composite indexes are required today. |
| `functions` | `functions/` | Builds TypeScript via the `predeploy` hook. Needs the `JOTFORM_API_KEY` secret to exist. |
| `hosting` | `out/` | Produced by `npm run build`. `trailingSlash` is on, so every page is a folder with an `index.html`. |

## 9. Verify

1. Open the site and sign in with the Google account from step 6. You should land on the dashboard with the "Getting started" checklist.
2. Settings → JotForm connection → **Test connection** should show your JotForm username. If it fails with a permission error, the secret is missing or the key lacks Full Access.
3. Add a test item, create an event, add batch 1, pick the item, **Generate form**. The batch card shows the form URL.
4. In JotForm, confirm the form exists and that **Settings → Integrations → Webhooks** lists the function URL `https://asia-southeast1-<project-id>.cloudfunctions.net/jotformWebhook`.
5. Submit the form once. Within a few seconds the order appears on the event's Orders tab. If it does not, open the function logs:

```bash
firebase functions:log --only jotformWebhook
```

6. Delete the test item and event afterwards, or keep the event and cancel the test order.

## 10. Day-to-day operations

- **Adding staff:** Settings → Staff → Add. Deactivate instead of deleting so names stay on history.
- **Rotating the JotForm key:** step 5, then `firebase deploy --only functions`.
- **Backups:** Firestore has no automatic backups on the free tier. Schedule exports with `gcloud firestore export gs://<bucket>` from Cloud Scheduler, or at least export CSVs from the app before and after each event.
- **Missed webhooks:** on the batch card, **Re-import** pulls every submission for the form through the same import path. It is safe to run repeatedly; submissions are matched by their JotForm id.
- **Changing the offering after the form exists:** edit the offering, then **Re-sync fields**. New variants are added as fields, removed ones are deleted from the form. Customer fields are never touched.

## Local emulators (optional)

```bash
npm --prefix functions run build
firebase emulators:start
```

To point the web app at the emulators, add to `.env.local`:

```
NEXT_PUBLIC_USE_EMULATORS=1
```

`src/lib/firebase.ts` then connects Firestore, Auth, and Functions to the emulator ports in `firebase.json`. The emulated Firestore starts empty, so create the first `staff` document in the emulator UI (http://localhost:4000) just as in step 6. For the functions emulator to reach JotForm, create `functions/.secret.local` containing `JOTFORM_API_KEY=<key>`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Firebase is not configured" screen | `.env.local` missing or values blank | Step 7, then restart `npm run dev` |
| "Not on the staff list" after sign-in | No active `staff/<email>` document, or email case mismatch | Step 6; the document id must be lower-case |
| Sign-in popup blocked or `auth/unauthorized-domain` | Domain not in Authorized domains | Step 2 |
| Generate form fails with `permission-denied` | Signed-in user is not active staff, or the callable region differs from the app's | Check `staff` doc; check step 4 |
| Generate form fails with `JotForm POST /form` | Wrong key, key without Full Access, or EU account on the US base URL | Step 5 |
| Orders do not arrive | Webhook not registered, or the function errored | Step 9.4 and the logs; use Re-import meanwhile |
| Functions deploy fails on first run | Blaze plan not enabled, or APIs still enabling | Step 1.2; wait a minute and retry |
