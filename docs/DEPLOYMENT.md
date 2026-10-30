# Deployment Guide

Complete instructions to deploy Tsuchinoco from a fresh clone to a working production setup on Firebase, including console configurations, Cloud Storage, and day-to-day operations.

The current Firebase project is configured in `.firebaserc` (`tsuchinoco-318b2`).

---

## Architecture & Plan

Tsuchinoco runs entirely on the **Firebase Blaze plan** (pay-as-you-go with generous free tier allowances):

- **Firebase Hosting**: Serves the Next.js static export (`out/`). Both the staff management app and the customer preorder forms (`/f/?id=<batchId>`) are part of this build.
- **Cloud Firestore**: Holds application state, catalogue items, event batches, submissions, orders, and public form snapshots.
- **Cloud Storage**: Stores high-resolution item thumbnails (`media/{id}`) and customer payment proof receipts (`submissions/{id}/`).
- **Firebase Authentication**:
  - **Google Provider**: Authenticates staff members against the `staff` Firestore collection.
  - **Anonymous Provider**: Grants temporary customer credentials to submit preorder forms and upload payment receipts securely without creating user accounts.

> [!NOTE]
> No Cloud Functions are required for the standard preorder flow. All submission imports and pricing calculations run directly in the staff browser app.

---

## Prerequisites

- **Node.js 22 or newer** and npm.
- **Firebase CLI**: `npm install -g firebase-tools`, followed by `firebase login`.
- **Java 11 or newer** (only required if running local Firebase emulators).
- A **Google account** that will become the primary staff administrator.

---

## 1. Firebase Project & Plan Setup

In the [Firebase Console](https://console.firebase.google.com/):

1. Open your project (or create a new one).
2. Upgrade to the **Blaze plan** (Billing → Modify plan). Set a budget alert for peace of mind (daily usage for convention preorders typically stays within free quotas).
3. Under **Project settings → General → Your apps**, add a **Web app** (e.g. `tsuchinoco-web`).
4. Copy the `firebaseConfig` object keys; they will be placed in `.env.local` (Step 6).

---

## 2. Authentication Configuration

In the Firebase Console under **Build → Authentication**:

1. **Sign-in method → Add new provider → Google**:
   - Enable Google sign-in. Set a project support email and save.
2. **Sign-in method → Add new provider → Anonymous**:
   - Enable Anonymous sign-in. This enables customers on `/f/` to submit preorders and upload payment receipts under Firestore/Storage security rules without registration.
3. **Settings → Authorized domains**:
   - `localhost` and your `*.web.app` / `*.firebaseapp.com` domains are added automatically. Add any custom domain you connect later.

---

## 3. Firestore Database

In the Firebase Console under **Build → Firestore Database**:

1. Click **Create database**.
2. Select a region close to your circle/customers (e.g. `asia-southeast1` Singapore or `asia-southeast2` Jakarta).
3. Start in **production mode**. The repository's `firestore.rules` will be deployed in Step 7.

---

## 4. Cloud Storage

In the Firebase Console under **Build → Storage**:

1. Click **Get started**.
2. Choose the same region as your Firestore database.
3. Keep the default bucket name (e.g. `tsuchinoco-318b2.firebasestorage.app`).
4. When deploying storage rules for the first time, Firebase CLI may request permission to grant the cross-service IAM role so Cloud Storage can verify staff status via Firestore rules. Accept this prompt (`Yes`).

---

## 5. First Staff Administrator (One-time Setup)

Firestore security rules enforce that only emails listed in the `staff` collection can access admin functions. Because the collection starts empty, create the first administrator record manually:

**Firestore Database → Data → Start collection:**

- **Collection ID**: `staff`
- **Document ID**: your Google account email in **all lower-case** (e.g. `fary290796@gmail.com`)
- **Fields**:

| Field | Type | Value |
| :--- | :--- | :--- |
| `email` | string | same as document ID (lower-case) |
| `displayName` | string | your name |
| `active` | boolean | `true` |
| `createdAt` | number | current timestamp (e.g. `0`) |
| `updatedAt` | number | current timestamp (e.g. `0`) |
| `updatedBy` | string | `console` |

> [!TIP]
> After this initial document is created, all subsequent team members can be added directly inside the app under **Settings → Staff**.

---

## 6. Environment Configuration

Copy the template to create your local environment file:

```bash
cp env.template .env.local
```

Fill in `.env.local` with your project credentials:

```ini
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=tsuchinoco-318b2.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=tsuchinoco-318b2
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=tsuchinoco-318b2.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=1:...

# Optional: JotForm API Key for importing past thumbnails & form items
JOTFORM_API_KEY=your_jotform_api_key_here
```

---

## 7. Build and Deploy

Run the following commands from the project root:

```bash
# 1. Install dependencies
npm install

# 2. Typecheck and build the Next.js static export
npm run build

# 3. Deploy Firestore rules/indexes, Cloud Storage rules, and Hosting
firebase deploy --only firestore,storage,hosting
```

### What Each Deploy Target Deploys

| Target | Source Files | Description |
| :--- | :--- | :--- |
| `firestore` | `firestore.rules`, `firestore.indexes.json` | Staff access control, anonymous customer submission limits, and compound indexes. |
| `storage` | `storage.rules` | Public read access for item thumbnails (`media/**`) and anonymous customer upload access for payment receipts (`submissions/**`). |
| `hosting` | `out/` | Pre-rendered static pages for both the staff app and public preorder forms (`/f/?id=...`). |

The live application will be served at `https://<project-id>.web.app`.

---

## 8. Importing Assets from JotForm (Optional)

If migrating from an existing JotForm convention form:

```bash
# Preview matched catalogue items and thumbnails without writing
npm run import:jotform

# Download images from JotForm, upload to Cloud Storage, and link thumbnails
npm run import:jotform -- --apply
```

This script matches your Firestore catalogue items against JotForm products, uploads thumbnails to Cloud Storage, creates Firestore `media` documents, and extracts your QRIS payment image.

---

## 9. Day-to-Day Operations

- **Managing Staff**: Add or invite team members under **Settings → Staff**. Set a member to inactive instead of deleting to preserve their edit audit trails.
- **Creating & Customizing Preorder Forms**:
  1. Go to **Events** → Select or create an event (e.g. `CF23`).
  2. In **Batch 1**, select **Edit offering** to choose which items and bundles to sell.
  3. Click **Create form**, then click **Edit layout** to open the **Form Studio** (`/forms/editor/?id=<batchId>`).
  4. Customize product blocks (grid or list), attach your QRIS barcode & bank instructions in the **Payment & QRIS** block, select a theme preset (e.g. *Warm Cream* or *Midnight Cyber*), and adjust settings.
  5. Click **Publish**. Share the generated public link (`https://<project-id>.web.app/f/?id=<batchId>`) with buyers.
- **Handling Customer Submissions**:
  - When buyers submit their order and upload receipt images, submissions are saved to the `submissions` collection.
  - When staff has the app open (e.g. in **Orders**), submissions are automatically validated, expanded into order lines, and given sequential order IDs (e.g. `CF23_1_0001`).
  - Open any order in the Orders tab to view the customer's uploaded payment proof receipt.
- **Pausing or Closing Forms**:
  - To pause orders without closing the batch, toggle **Accepting** off on the **Forms** list page.
  - To finalize and close the batch, click **Close batch** on the event batch card.

---

## 10. Local Development & Emulators

To run locally with the Firebase Emulator Suite:

1. Start emulators:
   ```bash
   firebase emulators:start --only auth,firestore,storage,hosting
   ```
2. Enable emulators in `.env.local`:
   ```ini
   NEXT_PUBLIC_USE_EMULATORS=1
   ```
3. Run the Next.js development server:
   ```bash
   npm run dev
   ```
   - Staff dashboard: `http://localhost:3000`
   - Public preorder form: `http://localhost:3000/f/?id=<batchId>`
   - Firebase Emulator UI: `http://localhost:4000`

---

## 11. Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **"Firebase is not configured" screen** | `.env.local` is missing or keys are blank | Ensure `.env.local` has all 6 `NEXT_PUBLIC_FIREBASE_*` variables and restart `npm run dev`. |
| **"Not on the staff list" after sign-in** | Missing `staff/<email>` record or letter casing mismatch | Check Step 5 in Firestore. The document ID must be all lower-case. |
| **Sign-in popup blocked or `auth/unauthorized-domain`** | Custom domain not listed in authorized domains | Add the domain under Firebase Console → Authentication → Settings → Authorized domains. |
| **Customer form says "could not submit" (`permission-denied`)** | Anonymous authentication is disabled or Firestore rules are out of date | Enable Anonymous provider in Auth (Step 2.2) and run `firebase deploy --only firestore`. |
| **Payment receipt upload fails on customer form** | Cloud Storage rules not deployed or bucket name misconfigured | Ensure `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` matches your console bucket and run `firebase deploy --only storage`. |
| **Public form shows "Form not found"** | Batch form has not been published yet | Click **Publish** on the batch card or in the Form Studio. |
| **Orders do not appear after submission** | No staff member has the web app open | Open the **Orders** page in any browser tab; the client-side importer processes pending submissions into orders. |
