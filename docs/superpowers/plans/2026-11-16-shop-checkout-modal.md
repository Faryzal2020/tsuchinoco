# Shop Checkout Modal, Cart Panel and Saved Addresses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shop's bottom cart bar and one-page checkout with a collapsible cart panel and a four-step checkout modal that survives refresh, and remember shipping addresses per Google account.

**Architecture:** `Shop` stays pure UI; two new components (`CartPanel`, `CheckoutModal`) take the cart lines and the lane as props and hand the finished `ShopDraft` back through the existing `onSubmit`. Pure state logic (checkout state in `sessionStorage`, the address book merge rules) lives in `src/lib` with no React or Firebase imports, checked by scripts run with jiti. Firestore gets one new collection, `customers/{uid}`, with own-uid rules, reached through an `addressBook` on `ShippingDeps` so the live page, the sandbox and the staff preview plug in different implementations.

**Tech Stack:** Next.js 16 static export, React 19, Firebase 13 (Firestore, Auth, Storage), plain CSS with theme variables in `src/components/shop/shop.css`, jiti 2 for running TypeScript check scripts under Node.

**Spec:** `docs/superpowers/specs/2026-11-16-shop-checkout-modal-design.md`

## Global Constraints

- Only `/shop/` changes. `src/components/forms/FormRenderer.tsx`, `src/app/f/`, `src/lib/customerAuth.ts` (`useShippingDeps`) and every staff page keep their behaviour; the staff Storefront preview only renders the new components.
- `Shop.tsx`, `CartPanel.tsx` and `CheckoutModal.tsx` import nothing from `firebase/*` or `@/lib/firebase`.
- The submission shape and `validSubmission` / `validShipping` in `firestore.rules` do not change.
- Styling uses the `--s-*` theme variables in `shop.css`; the mobile breakpoint is `max-width: 640px`; no new icon except the cart icon on the panel handle (inline SVG, `stroke="currentColor"`, no lucide).
- `sessionStorage` keys: `tsu.shop.checkout` (checkout state) and `tsu.shop.panel` (cart panel open/closed). Cart stays in `localStorage` under the existing `tsu.shop.cart`. Nothing is stored when the `preview` prop is set.
- Saved addresses: at most 5 per customer; the receipt file is required on the payment step; `paymentProofUrl` stays optional in the rules.
- Commit after each task with a conventional message; no push.

## Review Focus

- A customer refreshes mid-checkout after staff close the lane: `readCheckout` must fall back to a fresh state when the stored `laneId` has no matching choice, and the modal must not open on a lane that is gone (Task 2 test, Task 6 step 7).
- The stored `step` points past a step the restored data no longer satisfies: missing contact fields send the customer back to `details` at mount (`clampStep`, Task 2 test, Task 6 step 1); a shipping problem that only shows once the quote is back (sign-in lost, no delivery, service gone) is shown as a banner on the review and payment steps with a way back, never a silent jump (Task 6 steps 4 and 5).
- Two saved addresses that differ only in whitespace or case must merge, and the sixth distinct address must evict the least recently used, never the newest (Task 1 tests).
- A `customers/{uid}` write with a sixth address or an address over 600 characters must be refused by the rules, and an anonymous customer must not be able to write any (Task 3 rule text; no emulator on this machine, so this is read-checked and verified after deploy).
- On a phone, the collapsed puller must not sit over the last product card's "Add to cart" button, and the page behind the open sheet stays usable once it is closed (Task 5 browser check at 375px width).

---

### Task 1: Address book rules (pure)

**Files:**
- Create: `src/lib/addressBook.ts`
- Create: `scripts/checks/addressBook.mjs`

**Interfaces:**
- Produces:
  ```ts
  export interface SavedAddress { id: string; postalCode: string; address: string; lastUsedAt: number }
  export interface AddressBook { load: (uid: string) => Promise<SavedAddress[]>; save: (uid: string, list: SavedAddress[]) => Promise<void> }
  export const MAX_SAVED_ADDRESSES = 5;
  export function addressKey(postalCode: string, address: string): string;
  export function rememberAddress(list: SavedAddress[], a: { postalCode: string; address: string }, now: number, newId: () => string): SavedAddress[];
  export function forgetAddress(list: SavedAddress[], id: string): SavedAddress[];
  export function findAddress(list: SavedAddress[], postalCode: string, address: string): SavedAddress | undefined;
  ```

- [ ] **Step 1: Write the failing check script**

`scripts/checks/addressBook.mjs` loads the module with jiti and asserts with `node:assert/strict`:

```js
import { createJiti } from 'jiti';
import assert from 'node:assert/strict';
const jiti = createJiti(import.meta.url, { alias: { '@': new URL('../../src', import.meta.url).pathname } });
const { addressKey, rememberAddress, forgetAddress, findAddress, MAX_SAVED_ADDRESSES } = await jiti.import('../../src/lib/addressBook.ts');
let n = 0; const id = () => `a${++n}`;

assert.equal(addressKey('16920', '  Jl. Mawar  No. 3,\nBogor '), '16920|jl. mawar no. 3, bogor');
assert.equal(addressKey('16920', 'JL. MAWAR NO. 3, BOGOR'), addressKey('16920', 'jl. mawar no. 3, bogor'));

const one = rememberAddress([], { postalCode: '16920', address: 'Jl. Mawar 3' }, 1000, id);
assert.deepEqual(one, [{ id: 'a1', postalCode: '16920', address: 'Jl. Mawar 3', lastUsedAt: 1000 }]);
// Same address, different case and spacing: no new entry, lastUsedAt moves, stored text is the new one trimmed.
const same = rememberAddress(one, { postalCode: '16920', address: '  jl. mawar   3 ' }, 2000, id);
assert.equal(same.length, 1); assert.equal(same[0].id, 'a1'); assert.equal(same[0].lastUsedAt, 2000); assert.equal(same[0].address, 'jl. mawar 3');
// Most recently used first.
const two = rememberAddress(same, { postalCode: '40115', address: 'Jl. Braga 1' }, 3000, id);
assert.deepEqual(two.map((a) => a.id), ['a2', 'a1']);
// Sixth distinct address evicts the least recently used (a1), never the newest.
let list = two;
for (let t = 4000; t <= 7000; t += 1000) list = rememberAddress(list, { postalCode: '1000' + (t / 1000), address: `Addr ${t}` }, t, id);
assert.equal(list.length, MAX_SAVED_ADDRESSES);
assert.ok(!list.some((a) => a.id === 'a1'));
assert.equal(list[0].lastUsedAt, 7000);
// Forget and find.
assert.deepEqual(forgetAddress(two, 'a2').map((a) => a.id), ['a1']);
assert.equal(findAddress(two, '40115', 'JL. BRAGA 1')?.id, 'a2');
assert.equal(findAddress(two, '40115', 'Jl. Braga 2'), undefined);
console.log('addressBook ok');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/checks/addressBook.mjs`
Expected: fails to import `src/lib/addressBook.ts` (module not found).

- [ ] **Step 3: Implement `src/lib/addressBook.ts`**

No imports. `addressKey` trims, collapses whitespace runs to one space, lower-cases, and joins as `${postalCode.trim()}|${text}`. `rememberAddress` stores `address.trim().replace(/\s+/g, ' ')`, updates the matching entry (by key) in place or appends a new one with `newId()`, sorts by `lastUsedAt` descending and slices to `MAX_SAVED_ADDRESSES`. `findAddress` compares keys. Header comment: "Pure: no Firebase or React, shared by the shop, the sandbox and the check script."

- [ ] **Step 4: Run the check to verify it passes**

Run: `node scripts/checks/addressBook.mjs`
Expected: `addressBook ok`

- [ ] **Step 5: Commit**

```bash
git add src/lib/addressBook.ts scripts/checks/addressBook.mjs
git commit -m "feat(shop): address book merge rules"
```

---

### Task 2: Checkout state across refresh (pure)

**Files:**
- Create: `src/lib/checkoutState.ts`
- Create: `scripts/checks/checkoutState.mjs`

**Interfaces:**
- Consumes: `OrderType` from `@/types` (`import type`).
- Produces:
  ```ts
  export type StepId = 'fulfilment' | 'details' | 'review' | 'payment';
  export interface CheckoutState {
    laneId: string; step: StepId; fulfilment: 'pickup' | 'mail';
    name: string; email: string; phone: string; day: string; notes: string;
    postal: string; address: string; service: string; pay: string; open: boolean;
  }
  export const CHECKOUT_KEY = 'tsu.shop.checkout';
  export const EMAIL_RE: RegExp;                       // moved here from Shop.tsx, same pattern
  export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
  export function stepsFor(kind: OrderType): StepId[];  // preorder: all four; mail_order: without 'fulfilment'
  export function emptyCheckout(laneId: string, kind: OrderType, defaultPay: string): CheckoutState;
  export function readCheckout(kv: KV | undefined, laneId: string, kind: OrderType, defaultPay: string): CheckoutState;
  export function writeCheckout(kv: KV | undefined, s: CheckoutState): void;
  export function clearCheckout(kv: KV | undefined): void;
  export interface StepChecks { needDay: boolean; shipped: boolean; shippingProblem: string }
  export function detailsProblems(s: CheckoutState, c: StepChecks): Record<string, string>;
  export function clampStep(s: CheckoutState, kind: OrderType, c: StepChecks): StepId;
  ```

- [ ] **Step 1: Write the failing check script**

```js
import { createJiti } from 'jiti';
import assert from 'node:assert/strict';
const jiti = createJiti(import.meta.url, { alias: { '@': new URL('../../src', import.meta.url).pathname } });
const m = await jiti.import('../../src/lib/checkoutState.ts');
const kv = () => { const s = new Map(); return { getItem: (k) => s.get(k) ?? null, setItem: (k, v) => s.set(k, String(v)), removeItem: (k) => s.delete(k) }; };

assert.deepEqual(m.stepsFor('preorder'), ['fulfilment', 'details', 'review', 'payment']);
assert.deepEqual(m.stepsFor('mail_order'), ['details', 'review', 'payment']);
const pre = m.emptyCheckout('store_cf24_1', 'preorder', 'Bank transfer');
assert.equal(pre.step, 'fulfilment'); assert.equal(pre.fulfilment, 'pickup'); assert.equal(pre.pay, 'Bank transfer'); assert.equal(pre.open, false);
const mo = m.emptyCheckout('store_mail', 'mail_order', 'QRIS');
assert.equal(mo.step, 'details'); assert.equal(mo.fulfilment, 'mail');

// Round trip; a lane mismatch falls back to empty; garbage falls back to empty.
const store = kv();
const typed = { ...pre, step: 'details', name: 'Ayu', address: 'Jl. Mawar 3', postal: '16920', open: true };
m.writeCheckout(store, typed);
assert.deepEqual(m.readCheckout(store, 'store_cf24_1', 'preorder', 'Bank transfer'), typed);
assert.deepEqual(m.readCheckout(store, 'store_mail', 'mail_order', 'Bank transfer'), m.emptyCheckout('store_mail', 'mail_order', 'Bank transfer'));
store.setItem(m.CHECKOUT_KEY, '{not json');
assert.deepEqual(m.readCheckout(store, 'store_cf24_1', 'preorder', 'Bank transfer'), pre);
m.clearCheckout(store); assert.equal(store.getItem(m.CHECKOUT_KEY), null);
// No storage at all (preview / SSR): empty, and writes are no-ops.
assert.deepEqual(m.readCheckout(undefined, 'store_mail', 'mail_order', 'QRIS'), mo);
m.writeCheckout(undefined, mo); m.clearCheckout(undefined);

// Details validation.
const ok = { ...pre, fulfilment: 'mail', name: 'Ayu', email: 'ayu@example.com', phone: '0812', address: 'Jl. Mawar 3', postal: '16920', service: 'reg_pack' };
assert.deepEqual(m.detailsProblems(ok, { needDay: false, shipped: true, shippingProblem: '' }), {});
const bad = m.detailsProblems({ ...ok, name: ' ', email: 'nope', phone: '', address: '' }, { needDay: false, shipped: true, shippingProblem: 'Choose a shipping service.' });
assert.deepEqual(Object.keys(bad).sort(), ['address', 'email', 'name', 'phone', 'ship']);
assert.equal(bad.email, 'That e-mail address does not look right.');
assert.equal(bad.address, 'Required for shipping');
assert.equal(m.detailsProblems({ ...ok, fulfilment: 'pickup', day: '' }, { needDay: true, shipped: false, shippingProblem: '' }).day, 'Choose a day');
assert.deepEqual(m.detailsProblems({ ...ok, fulfilment: 'pickup', address: '' }, { needDay: false, shipped: false, shippingProblem: 'ignored when not shipped' }), {});

// A stored step past what the data supports is clamped back to 'details'; otherwise kept.
assert.equal(m.clampStep({ ...ok, step: 'payment' }, 'preorder', { needDay: false, shipped: true, shippingProblem: 'Wait a moment for the shipping price.' }), 'details');
assert.equal(m.clampStep({ ...ok, step: 'payment' }, 'preorder', { needDay: false, shipped: true, shippingProblem: '' }), 'payment');
assert.equal(m.clampStep({ ...ok, step: 'fulfilment' }, 'preorder', { needDay: false, shipped: true, shippingProblem: 'x' }), 'fulfilment');
assert.equal(m.clampStep({ ...mo, step: 'fulfilment' }, 'mail_order', { needDay: false, shipped: true, shippingProblem: 'x' }), 'details');
console.log('checkoutState ok');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/checks/checkoutState.mjs`
Expected: module not found.

- [ ] **Step 3: Implement `src/lib/checkoutState.ts`**

`readCheckout` parses JSON, checks `laneId` equality and that every string field is a string, `open` a boolean and `step` one of `stepsFor(kind)`; anything else returns `emptyCheckout`. `detailsProblems` reproduces the current messages in `Shop.tsx` (`'Required'`, `'That e-mail address does not look right.'`, `'Choose a day'`, `'Required for shipping'`, and `ship: shippingProblem` when `shipped` and non-empty). `clampStep`: if `s.step` is not in `stepsFor(kind)` return the first step; if `s.step` is `review` or `payment` and `detailsProblems` is non-empty return `'details'`; else `s.step`.

- [ ] **Step 4: Run the check to verify it passes**

Run: `node scripts/checks/checkoutState.mjs`
Expected: `checkoutState ok`

- [ ] **Step 5: Commit**

```bash
git add src/lib/checkoutState.ts scripts/checks/checkoutState.mjs
git commit -m "feat(shop): checkout state saved in the session"
```

---

### Task 3: `customers/{uid}` in Firestore, rules and wiring

**Files:**
- Modify: `src/lib/repo.ts:30-55` (add `customers: 'customers'` to `COL`)
- Create: `src/lib/customerAddresses.ts`
- Modify: `src/lib/shippingQuote.ts:12-19` (`ShippingDeps`)
- Modify: `src/app/shop/page.tsx`
- Modify: `src/app/sandbox/shop/page.dev.tsx`
- Modify: `firestore.rules` (new block after the `customerOrders` block; catch-all exclusion list)
- Modify: `docs/DATA-MODEL.md` (new "Customers" table next to `customerOrders`)

**Interfaces:**
- Consumes: `SavedAddress`, `AddressBook` from Task 1.
- Produces:
  ```ts
  // src/lib/customerAddresses.ts
  export const firestoreAddressBook: AddressBook;   // doc(db, COL.customers, uid); load → data.addresses ?? []; save → setDoc({ addresses, updatedAt: Date.now() })
  // src/lib/shippingQuote.ts
  export interface ShippingDeps { customer; signIn; quote; addressBook?: AddressBook }   // `import type { AddressBook } from './addressBook'`
  ```

- [ ] **Step 1: Add the collection name, the Firestore address book and the `addressBook` field**

`customerAddresses.ts` is `'use client'`, imports `db` from `./firebase`, `COL` from `./repo`, `doc/getDoc/setDoc` from `firebase/firestore`. `load` returns `[]` when the document does not exist or `addresses` is not an array.

- [ ] **Step 2: Wire the live page and the sandbox**

In `src/app/shop/page.tsx`: `const shippingDeps = useShippingDeps(); const shipping = useMemo(() => ({ ...shippingDeps, addressBook: firestoreAddressBook }), [shippingDeps]);` and pass `shipping`. `useShippingDeps` itself is not changed.
In `src/app/sandbox/shop/page.dev.tsx`: an in-memory book held in a `useRef<Record<string, SavedAddress[]>>({ 'sbx-customer': [{ id: 'sbx-a1', postalCode: '40115', address: 'Jl. Braga 1, Bandung', lastUsedAt: 1 }] })`; `load` resolves the uid's list or `[]`, `save` replaces it. Added to the `shipping` memo.

- [ ] **Step 3: Rules**

After the `customerOrders` block add "Public exception 7":

```
    function validSavedAddress(a) {
      return a is map && a.keys().hasOnly(['id', 'postalCode', 'address', 'lastUsedAt']) && a.keys().hasAll(['id', 'postalCode', 'address', 'lastUsedAt'])
        && str(a.id, 40) && a.id.size() > 0
        && a.postalCode is string && a.postalCode.matches('^[1-9][0-9]{4}$')
        && str(a.address, 600) && a.address.size() > 0
        && a.lastUsedAt is number;
    }
    function validCustomerDoc() {
      let d = request.resource.data;
      return d.keys().hasOnly(['addresses', 'updatedAt']) && d.keys().hasAll(['addresses', 'updatedAt'])
        && d.updatedAt is number
        && d.addresses is list && d.addresses.size() <= 5
        && (d.addresses.size() < 1 || validSavedAddress(d.addresses[0]))
        && (d.addresses.size() < 2 || validSavedAddress(d.addresses[1]))
        && (d.addresses.size() < 3 || validSavedAddress(d.addresses[2]))
        && (d.addresses.size() < 4 || validSavedAddress(d.addresses[3]))
        && (d.addresses.size() < 5 || validSavedAddress(d.addresses[4]));
    }
    match /customers/{uid} {
      allow read, delete: if request.auth != null && request.auth.uid == uid
        && request.auth.token.firebase.sign_in_provider == 'google.com';
      allow create, update: if request.auth != null && request.auth.uid == uid
        && request.auth.token.firebase.sign_in_provider == 'google.com'
        && validCustomerDoc();
    }
```

Add `'customers'` to the catch-all's exclusion list with a comment line: "customers holds saved addresses that only the customer reads".

- [ ] **Step 4: Document the collection**

In `docs/DATA-MODEL.md`, next to `customerOrders`, a "Customers" subsection: document id is the Google uid, the `addresses` list (max 5, most recently used first, fields as in Task 1), `updatedAt`; written by the shop after a shipped order; nothing staff-side reads it.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src --quiet`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/repo.ts src/lib/customerAddresses.ts src/lib/shippingQuote.ts src/app/shop/page.tsx src/app/sandbox/shop/page.dev.tsx firestore.rules docs/DATA-MODEL.md
git commit -m "feat(shop): customers collection for saved addresses"
```

---

### Task 4: Pull shared pieces out of `Shop.tsx`

**Files:**
- Create: `src/components/shop/parts.tsx`
- Modify: `src/components/shop/Shop.tsx`

**Interfaces:**
- Produces (moved verbatim from `Shop.tsx`, now exported): `Priced`, `Line` (interfaces), `Stepper`, `Text`, `ShopShipping`, `shippingProblem`. `EMAIL_RE` comes from `@/lib/checkoutState` (Task 2) and the local constant is removed.
  ```ts
  export interface Priced { variant: StoreVariant; product: StoreProduct; price: StorePrice; orderable: boolean }
  export interface Line { key: string; qty: number; p?: Priced }
  export function Stepper(p: { value: number; max: number; onChange: (v: number) => void; label: string }): JSX.Element;
  export function Text(p: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; type?: string; autoComplete?: string }): JSX.Element;
  export function ShopShipping(p: { q: ShippingQuoteHook; live: boolean; currency: string; error?: string }): JSX.Element;
  export function shippingProblem(q: ShippingQuoteHook, live: boolean): string;
  ```

- [ ] **Step 1: Move the pieces**

Cut the six definitions out of `Shop.tsx`, paste into `parts.tsx` with `'use client'` and the needed imports (`formatMoney`, `ShippingQuoteHook`, types). Import them back into `Shop.tsx`. Behaviour unchanged.

- [ ] **Step 2: Typecheck, lint, build**

Run: `rm -rf .next/dev && npx tsc --noEmit && npx eslint src --quiet && npm run build 2>&1 | tail -5`
Expected: build ends with the route table and no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/shop/parts.tsx src/components/shop/Shop.tsx
git commit -m "refactor(shop): move shared checkout parts into parts.tsx"
```

---

### Task 5: Cart panel

**Files:**
- Create: `src/components/shop/CartPanel.tsx`
- Modify: `src/components/shop/Shop.tsx` (replace `.shop-cartbar`; the old `Checkout` keeps opening from the panel's button until Task 6)
- Modify: `src/components/shop/shop.css` (remove `.shop-cartbar` rules; add `.shop-cart*`)

**Interfaces:**
- Consumes: `Line`, `Stepper` from Task 4; `StoreChoice` from `@/lib/store`.
- Produces:
  ```ts
  export interface CartPanelProps {
    currency: string; choice: StoreChoice; okLines: Line[]; badLines: Line[]; total: number; max: number;
    setQty: (key: string, qty: number) => void; removeBad: () => void;
    open: boolean; onToggle: (open: boolean) => void; onCheckout: () => void; preview?: boolean;
  }
  export default function CartPanel(p: CartPanelProps): JSX.Element;
  export const PANEL_KEY = 'tsu.shop.panel';
  ```

- [ ] **Step 1: Build the component**

Root `<aside className={`shop-cart ${open ? 'is-open' : ''}`} aria-label="Cart">`. Handle: `<button type="button" className="shop-cart-handle" aria-expanded={open} aria-controls="shop-cart-body" onClick={() => onToggle(!open)}>` containing `<CartIcon />` (inline 24px SVG, outline basket, `stroke="currentColor" fill="none" strokeWidth="1.8" aria-hidden="true"`) and `<span className="shop-cart-count">{count}</span>` where `count` is the sum of `okLines` quantities; `sr-only` text "Cart, {count} items". Body `<div id="shop-cart-body" className="shop-cart-body">`: heading row "Cart · {choice.label}", the lines list reusing the `.shop-lines` markup from the old `Checkout` (name, variant, unit price, `Stepper`, line total; unavailable lines with "Remove"), "Remove unavailable items" when needed, an `Items` total row, then a footer with `Checkout` (`shop-btn shop-btn-primary`, `disabled` when `okLines.length === 0 || badLines.length > 0`) and a `Keep shopping` button that calls `onToggle(false)`. Under a disabled Checkout, a `shop-hint`: "Your cart is empty." or "Remove the unavailable items first."

- [ ] **Step 2: Mount it in `Shop.tsx`**

Replace the `shop-cartbar` block with `<CartPanel currency={catalog.currency} … open={panelOpen} onToggle={setPanel} onCheckout={() => setOpen(true)} preview={preview} />`, rendered when `choice && !done && !open` (the old bar also required `lines.length > 0`; the panel does not). Panel state: `const [panelOpen, setPanelOpen] = useState(false)`; after mount (not in preview) read `sessionStorage.getItem(PANEL_KEY)`: `'1'` → open, otherwise closed. `setPanel(v)` sets state and writes `'1'`/`'0'`. First-add rule: in an effect on `count`, when the previous count (a ref) was 0, the new count is above 0, nothing is stored yet and `window.matchMedia('(min-width: 641px)').matches`, call `setPanel(true)`. Wrap every storage call in try/catch like `read`/`write` in `Shop.tsx`.

- [ ] **Step 3: CSS**

Desktop (default): `.shop-cart` is `position: fixed; top: 0; right: 0; height: 100vh; width: min(360px, 92vw); z-index: 20; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--s-surface); border-left: 1.5px solid var(--s-ink); transform: translateX(100%); transition: transform .2s ease;` and `.is-open { transform: none }`. The handle: `position: absolute; right: 100%; top: 50%; transform: translateY(-50%); display: grid; gap: 2px; justify-items: center; padding: 10px 8px; background: var(--s-surface); border: 1.5px solid var(--s-ink); border-right: 0; border-radius: var(--s-r-sm) 0 0 var(--s-r-sm); box-shadow: -3px 3px 0 var(--s-ink); color: var(--s-ink); cursor: pointer;` with `.shop-cart-count` in `--s-mono`, bold. The body scrolls (`overflow: auto`, 16px padding).
Mobile (`@media (max-width: 640px)`): the panel becomes a sheet: `top: auto; bottom: 0; left: 0; right: 0; width: auto; height: auto; max-height: 70vh; border-left: 0; border-top: 1.5px solid var(--s-ink); border-radius: var(--s-radius) var(--s-radius) 0 0; transform: translateY(100%)`, `.is-open { transform: none }`. The collapsed sheet is fully off-screen, so the collapsed handle is `position: fixed; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); top: auto; left: auto; transform: none; border-radius: var(--s-r-sm); border-right: 1.5px solid var(--s-ink); box-shadow: 0 3px 0 var(--s-ink); flex-direction: row` (icon and count side by side); under `.is-open` it moves to `position: absolute; right: 12px; bottom: 100%; border-bottom: 0; border-radius: var(--s-r-sm) var(--s-r-sm) 0 0`.
Preview: `.shop.is-preview .shop-cart` uses the mobile rules (repeat the mobile selectors under `.shop.is-preview`) but `position: sticky; bottom: 0; transform: none`, with `.shop-cart-body` `display: none` unless `.is-open`, and the handle `position: absolute` in both states.
`@media (prefers-reduced-motion: reduce) { .shop-cart { transition: none } }`. Flat, pill and outline button themes drop the handle's box-shadow, like `.shop-option.is-on`. Keep `.shop { padding-bottom: 120px }` so the puller never covers the last card's buttons.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src --quiet`
Expected: no output.

- [ ] **Step 5: Browser check in the sandbox**

Start the dev server with `preview_start` (launch config `dev`; `/sandbox/` needs no sign-in). Open `/sandbox/shop/`, pick the preorder lane if asked, add one item.
Expected on desktop width: the panel slides in from the right with the item, "Items" total and an enabled Checkout; the catalogue grid behind it does not shift. Click "Keep shopping": only the handle with the cart icon and `1` remains at the right edge, vertically centred; no product card is covered. Reload: the handle is still collapsed.
Resize to 375px (`resize_window` mobile) and reload: the puller sits bottom-right with the count; tap it: the sheet rises from the bottom to at most 70% of the height and scrolls on its own; close it: the last product card's "Add to cart" is clickable.
Open `/sandbox/storefront/` and show the preview: the panel is sticky at the bottom of the preview box, not stuck to the window.

- [ ] **Step 6: Commit**

```bash
git add src/components/shop/CartPanel.tsx src/components/shop/Shop.tsx src/components/shop/shop.css
git commit -m "feat(shop): collapsible cart panel replaces the cart bar"
```

---

### Task 6: Checkout modal with steps and refresh-safe state

**Files:**
- Create: `src/components/shop/CheckoutModal.tsx`
- Modify: `src/components/shop/Shop.tsx` (delete the old `Checkout` function; render the modal)
- Modify: `src/components/shop/parts.tsx` (`ShopShipping` gains an optional `onPostal` prop)
- Modify: `src/components/shop/shop.css` (add `.shop-modal*`, `.shop-steps*`, `.shop-review*`; keep `.shop-checkout*` for `ContactForm`)

**Interfaces:**
- Consumes: Task 2 (`CheckoutState`, `StepId`, `stepsFor`, `readCheckout`, `writeCheckout`, `clearCheckout`, `emptyCheckout`, `detailsProblems`, `clampStep`), Task 4 (`Line`, `Text`, `ShopShipping`, `shippingProblem`), `useShippingQuote`, `shipRule`, `ShippingDeps` from `@/lib/shippingQuote`, `confirmationCode` from `@/lib/forms`, `ShopDraft` from `./Shop` (`import type`).
- Produces:
  ```ts
  export interface CheckoutModalProps {
    catalog: StoreCatalog; choice: StoreChoice; okLines: Line[]; badLines: Line[]; total: number;
    deps?: ShippingDeps; preview?: boolean;
    state: CheckoutState; patch: (p: Partial<CheckoutState>) => void;
    onSubmit: (d: ShopDraft, proof: File | undefined, grandTotal: number, extras: [string, number][]) => Promise<void>;
  }
  export default function CheckoutModal(p: CheckoutModalProps): JSX.Element;
  export function StepDots(p: { steps: StepId[]; current: StepId; onJump: (s: StepId) => void }): JSX.Element;
  ```
  `Shop.tsx` owns the state: `const [ck, setCk] = useState<CheckoutState>(() => emptyCheckout('', 'mail_order', defaultPay))`; an effect on `choice?.lane.id` (skipped in preview) does `setCk(readCheckout(sessionStorage, choice.lane.id, choice.lane.kind, defaultPay))`, or the empty state when there is no choice; `patch = (p) => setCk((s) => { const n = { ...s, ...p }; if (!preview) writeCheckout(sessionStorage, n); return n; })` where `defaultPay = catalog.paymentChoices[0] ?? ''`. The modal renders while `choice && ck.open && ck.laneId === choice.lane.id && !done`; the panel's `onCheckout` is `() => patch({ open: true })`.

- [ ] **Step 1: The dialog shell and the step indicator**

`<dialog className="shop-modal" aria-label="Checkout">` opened with `showModal()` in a mount effect like `Lightbox`; `onCancel` → `patch({ open: false })`; backdrop click (target === currentTarget) → same; a "Close" button in the header. On mount, also `patch({ step: clampStep(state, kind, { ...checks, shippingProblem: '' }) })` once: only the contact fields are checked here, because Firebase restores the Google session and the quote asynchronously after a reload, so a restored shipped order must not be bounced to `details` just because the sign-in and the quote are not back yet (steps 4 and 5 show a banner once they are and something is wrong). Header: `<StepDots steps={stepsFor(kind)} current={state.step} onJump={(s) => patch({ step: s })} />` above `<h2>Your {isPre ? 'preorder' : 'mail order'}</h2>`.
`StepDots`: `<ol className="shop-steps" aria-label="Checkout progress">`, one `<li>` per step laid out `display: flex; align-items: center; flex: 1` (last `li { flex: 0 }`); every `<li>` after the first draws the connecting segment with `::before` (`content: ''; flex: 1; height: 2px; background: var(--s-line)`), blue (`--s-blue`) when its step is done or current. The circle: a completed step is `<button type="button" className="shop-step is-done" onClick={() => onJump(step)}>`, the current one `<span className="shop-step is-current" aria-current="step">`, a future one `<span className="shop-step">`; each holds `sr-only` text `{labelOf(step)}, step {i + 1} of {steps.length}` with labels `fulfilment` → "Pick up or mail", `details` → "Your details", `review` → "Review", `payment` → "Payment". No visible text. `.shop-step`: 20px circle, `border: 2px solid var(--s-line); background: var(--s-surface); border-radius: 50%; padding: 0; flex: none`; `.is-done` and `.is-current` fill `background: var(--s-blue); border-color: var(--s-blue)`; `.is-current` adds `box-shadow: 0 0 0 3px var(--s-blue-soft)`.

- [ ] **Step 2: Step 1 — fulfilment**

Rendered when `state.step === 'fulfilment'` (preorder lanes only). Two `.shop-option` radios: "Pick up at the booth" / "At {choice.lane.eventName}" and "Ship after the event" / "Pay shipping now; it is sent after the event ends". Changing writes `patch({ fulfilment })`. Footer: `Continue` → `patch({ step: 'details' })`.

- [ ] **Step 3: Step 2 — details**

The quote hook lives in `CheckoutModal` (so it stays mounted across steps): `const q = useShippingQuote({ deps, form: choice.doc, lines: cartLines, active: shipped && okLines.length > 0, onSignedIn: (u) => patch({ name: state.name || u.name, email: state.email || u.email }) })` with `shipped = state.fulfilment === 'mail'`. Restore on mount: one effect calling `q.setPostal(state.postal)` and `q.setService(state.service)` when non-empty. `const setPostal = (v: string) => { q.setPostal(v); patch({ postal: v.replace(/\D/g, '').slice(0, 5) }); }` is what the UI uses; an effect on `q.option?.service` patches `service` when it differs from `state.service`. `const checks: StepChecks = { needDay: state.fulfilment === 'pickup' && days.length > 0, shipped, shippingProblem: shipped ? shippingProblem(q, !!deps) : '' }`.
Fields: `Text` for name, e-mail, phone with the old ids and `autoComplete` values, bound to `state` through `patch`; pick-up day `<select id="shop-day">` when `checks.needDay`; when `shipped`: `<ShopShipping q={q} live={!!deps} currency={catalog.currency} error={err.ship} />` but with the postcode input driven by `setPostal` (pass `onPostal={setPostal}` as a new optional prop on `ShopShipping`, defaulting to `q.setPostal`), then, when `q.state !== 'signin' || !deps`, the address textarea (`id="shop-address"`, same placeholder, bound to `state.address`), then `<p className="shop-hint">{shipRule(kind)}</p>` and on mail-order lanes the existing "Mail orders ship after current events end…" line. Notes textarea (`shop-notes`, bound to `state.notes`) and the honeypot (`website` in local `useState`, never persisted). Footer: `Back` (preorder only, → `'fulfilment'`) and `Continue`: `const e = detailsProblems(state, checks); setErr(e); if (!Object.keys(e).length) patch({ step: 'review' })`. The saved-address picker is Task 7.

- [ ] **Step 4: Step 3 — review (read-only)**

`<section className="shop-review">`: the lines as `.shop-lines` without steppers (name, variant, `{qty} ×`, line total), `.shop-breakdown` with items / `Shipping · {q.option.name} · {q.result.billedKg} kg` / handling / packaging when `shipped && q.option && q.result`, then `.shop-total` with `grandTotal = total + (shipped ? q.extra : 0)`. Two `<dl className="shop-review-block">`: "How you get it" (pick-up: "Pick up at the booth · {eventName}" and the day when set; mail: address, postcode, service name and price) with an "Edit" `shop-link` → `patch({ step: isPre ? 'fulfilment' : 'details' })`, and "Your details" (name, e-mail, phone, notes when non-empty) with "Edit" → `'details'`. Footer: `Back` → `'details'`, `Continue` → `'payment'`. No inputs in this step.
Shipping banner (shared by this step and the payment step): `const shipIssue = shipped && q.state !== 'loading' ? shippingProblem(q, !!deps) : ''`; when non-empty, render `<p className="shop-error">{shipIssue} <button type="button" className="shop-link" onClick={() => patch({ step: 'details' })}>Back to your details</button></p>` above the footer and disable `Continue` (here) and the place-order button (step 5). While `q.state === 'loading'` the breakdown shows "Shipping is being priced again…" as a `shop-hint` in place of the shipping lines.

- [ ] **Step 5: Step 4 — payment and placing the order**

Payment radios bound to `state.pay` (`patch({ pay })`), the disabled "Online payment · Coming soon", `catalog.paymentText`. File input `shop-proof` labelled "Receipt" (no "optional"), in local `useState<File | null>`; under it the existing JPG/PNG/PDF hint and, while `proof` is null, a `shop-hint`: "Upload your transfer receipt to place the order." If the modal mounted with `state.step === 'payment'` (a refresh on this step; a ref set in the mount effect), the hint reads "Choose your receipt again; files cannot be kept across a reload." Footer: `Back` → `'review'`, submit button `Place {isPre ? 'preorder' : 'mail order'} · {formatMoney(grandTotal, currency)}` disabled while `!proof || sending || okLines.length === 0 || badLines.length > 0 || !!shipIssue || (shipped && q.state === 'loading')`, with the shipping banner from step 4 above the footer when `shipIssue` is set. Submit builds the `ShopDraft` exactly as the old `Checkout.submit` did (`customer.address` only for mail; `postalCode`, `shipping: { quoteId, service }`, `customerUid` when `shipped && q.result && q.option`; `paymentMethod: state.pay` when set; `notes: state.notes.trim()`; `seen` from the lines; `code: confirmationCode()`), re-runs `detailsProblems(state, checks)` as a guard (non-empty → `setErr(e); patch({ step: 'details' })`), returns silently when the honeypot is filled, computes `extras` as before, then `await onSubmit(draft, proof, grandTotal, extras)`; on error `setErr({ submit: 'Could not send your order. Check your connection and try again.' })`. `Shop.tsx`'s `onSubmit` wrapper does what it did (`setDone`, `saveCart({})`, scroll to top) and additionally `clearCheckout(sessionStorage)` (not in preview) and `setCk(emptyCheckout(choice.lane.id, choice.lane.kind, defaultPay))`.

- [ ] **Step 6: Replace the old checkout in `Shop.tsx` and style the modal**

Delete `function Checkout` and the `open` state; render `<CheckoutModal … state={ck} patch={patch} />` as described in Interfaces, and change the panel's visibility condition to `choice && !done` (it may stay mounted under the modal's backdrop). `.shop-modal`: `border: 0; padding: 0; background: transparent; width: min(96vw, 680px); max-height: 94vh; margin: auto;` with `::backdrop` like `.shop-lightbox::backdrop`; `.shop-modal-body` takes the old `.shop-checkout` look (surface, 1.5px ink border, `0 4px 0` shadow, radius, 18px padding, grid gap 14px, the flat/pill/outline variant without the shadow) plus `overflow: auto; max-height: 94vh`. `.shop-modal-nav { display: flex; justify-content: space-between; gap: 10px; }`. Phones: `.shop-modal { width: 100vw; max-width: none; max-height: 100vh; margin: 0 }`, body `border-radius: 0; min-height: 100vh`.

- [ ] **Step 7: Typecheck, lint and browser check**

Run: `npx tsc --noEmit && npx eslint src --quiet`
Expected: no output.
In `/sandbox/shop/` (desktop): add two items, open the cart, press Checkout. Expected: a modal with four dots joined by a line, first dot filled; "Pick up at the booth" selected. Continue → second dot filled, "Your details" with name, e-mail, phone, pick-up day (if the fixture lane has days), notes. Leave the name empty and Continue → "Required" under Name, still on the second dot. Fill the fields; Continue → the review shows lines, total, "Pick up at the booth", your details, two "Edit" links and no inputs. Continue → payment; the place-order button is disabled with the receipt hint; set a small image through the file input (`form_input` on the input, or `javascript_tool` to attach a `File` and dispatch `change`) → enabled; place the order → the thank-you page with the code; `sessionStorage['tsu.shop.checkout']` is gone (check with `javascript_tool`).
Refresh check: add an item, choose "Ship after the event", sign in with the sandbox button, type a name and the postcode `40115`, then reload. Expected: the modal reopens on the second dot with the name, the postcode and the Lion options back.
Lane-gone check: with `javascript_tool`, rewrite `sessionStorage['tsu.shop.checkout']` with `laneId: 'nope'` and `open: true`, reload: the modal does not open.
Escape closes the modal; Checkout again returns to the same step. Mobile width: the modal fills the screen and scrolls.

- [ ] **Step 8: Commit**

```bash
git add src/components/shop/CheckoutModal.tsx src/components/shop/parts.tsx src/components/shop/Shop.tsx src/components/shop/shop.css
git commit -m "feat(shop): four-step checkout modal that survives a refresh"
```

---

### Task 7: Saved addresses in the details step

**Files:**
- Modify: `src/components/shop/CheckoutModal.tsx` (details step; after-order save)
- Modify: `src/components/shop/shop.css` (`.shop-saved*`)

**Interfaces:**
- Consumes: `SavedAddress`, `rememberAddress`, `forgetAddress`, `findAddress` from Task 1; `deps.addressBook` and `deps.customer` from Task 3; `setPostal` and `patch` from Task 6.

- [ ] **Step 1: Load the list once per signed-in uid while the modal is open**

In `CheckoutModal`: `const [saved, setSaved] = useState<SavedAddress[] | null>(null)`; an effect on `deps?.customer?.uid` and `deps?.addressBook`: when both exist, `addressBook.load(uid).then(setSaved).catch((e) => { console.error('[shop] addresses', e); setSaved([]); })`; otherwise `setSaved(null)`.

- [ ] **Step 2: The picker**

Rendered only when `shipped && deps?.customer && saved && saved.length > 0`, between the sign-in block and the postcode: `<fieldset className="shop-saved"><legend>Saved addresses</legend>` with a `.shop-radios` of `.shop-option` labels, one per entry (`<b>{a.postalCode}</b><span>{a.address}</span>`), checked when `findAddress(saved, state.postal, state.address)?.id === a.id`, `onChange` → `setPostal(a.postalCode); patch({ address: a.address })`; plus a "New address" option checked when none matches, `onChange` → `setPostal(''); patch({ address: '' })`. Each saved option also carries a `Forget` `shop-link` button (`onClick` with `e.preventDefault(); e.stopPropagation()`): `const next = forgetAddress(saved, a.id); setSaved(next); deps.addressBook.save(uid, next).catch(console.error)`. Under the address textarea, when `deps?.addressBook && deps.customer`: `<p className="shop-hint">We remember this address for your next order. You can forget it any time.</p>`. Selection is derived from the fields, so editing the postcode or text flips the picker to "New address" with no extra state.

- [ ] **Step 3: Save after a successful shipped order**

In the modal's submit, after `await onSubmit(...)` resolves: `if (shipped && deps?.addressBook && deps.customer && draft.postalCode && draft.customer.address) { const list = rememberAddress(saved ?? [], { postalCode: draft.postalCode, address: draft.customer.address }, Date.now(), confirmationCode); deps.addressBook.save(deps.customer.uid, list).catch((e) => console.error('[shop] save address', e)); }`. The order is already placed; a failed save only logs.

- [ ] **Step 4: Typecheck, lint, browser check**

Run: `npx tsc --noEmit && npx eslint src --quiet`
Expected: no output.
In `/sandbox/shop/`: choose "Ship after the event", sign in with the sandbox button. Expected: a "Saved addresses" group with `40115 · Jl. Braga 1, Bandung` and "New address" (checked). Pick the saved one → postcode `40115` and the address text fill and Lion options load; change one character of the address → "New address" becomes checked. Place a shipped order with postcode `16920` and a new address, click "Back to the shop", add an item and start another shipped order: the new address is listed first, Braga second. Press "Forget" on Braga → it disappears; close and reopen the checkout → still gone (the sandbox book lives for the page's life, so stay on client-side navigation).

- [ ] **Step 5: Commit**

```bash
git add src/components/shop/CheckoutModal.tsx src/components/shop/shop.css
git commit -m "feat(shop): remember shipping addresses per Google account"
```

---

### Task 8: Roadmap, build and final pass

**Files:**
- Modify: `docs/ROADMAP.md` (new section before "Later and undecided")
- Modify: `src/components/shop/Shop.tsx` header comment (mentions the panel and modal; "No icons anywhere" becomes "no icons except the cart handle")

- [ ] **Step 1: Roadmap**

Add "## Shop checkout — cart panel, step modal, saved addresses (built 2026-11-16)": three sentences on what changed for customers, the `customers/{uid}` collection, and the deploy note (`firebase deploy --only firestore:rules` before hosting; nothing server-side).

- [ ] **Step 2: Full verification**

Run: `node scripts/checks/addressBook.mjs && node scripts/checks/checkoutState.mjs && rm -rf .next/dev && npx tsc --noEmit && npx eslint src --quiet && npm run build 2>&1 | tail -8`
Expected: both `ok` lines, no type or lint output, a successful static build.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md src/components/shop/Shop.tsx
git commit -m "docs(shop): checkout modal and saved addresses"
```
