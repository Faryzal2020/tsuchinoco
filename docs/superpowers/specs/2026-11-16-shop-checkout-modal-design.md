# Shop: cart panel, multi-step checkout modal, saved addresses

Design agreed 2026-11-16. Scope: the customer storefront at `/shop/` only. The Forms customer
page (`/f/`) and every staff page are untouched.

## Intent

Customers should see what is in their cart while they browse, and check out in short, ordered
steps instead of one long form. Once signed in with Google for a shipped order, they should never
have to type the same address twice.

## Goals

- A cart panel on the shop page that is always reachable, never scrolls away, and does not cover
  the catalogue when collapsed.
- Checkout as a modal with at most four steps: pick up or mail → your details → review → payment.
  Steps that the order type makes pointless are not shown.
- A refresh in the middle of checkout brings the customer back to the same step with everything
  they typed still there (except a chosen receipt file, which browsers cannot keep).
- A receipt is required before a bank-transfer or QRIS order can be placed.
- Addresses typed by a Google-signed-in customer are offered again on their next shipped order.

## Non-goals

- Online payment (stays "Coming soon", disabled).
- Changes to the Forms customer page, the import, the order e-mails or any staff screen.
- Address validation beyond the 5-digit postcode the shipping quote already needs.
- Server code. The only backend change is Firestore rules for the new `customers` collection.

## Anti-goals

- Losing typed data on refresh or when the modal is closed and reopened.
- A collapsed cart that hides products, or a desktop panel that pushes the catalogue around.
- An icon-heavy look. The cart icon on the panel handle is the one icon on the page (the owner
  asked for it); everything else stays words.

## Constraints

- `Shop` in `src/components/shop/Shop.tsx` is pure UI: data in as props, orders out through
  `onSubmit`. The live page (`src/app/shop/page.tsx`), the staff preview (`preview` prop) and the
  localhost sandbox (`src/app/sandbox/shop/page.dev.tsx`) all render the same component, so new
  side effects (loading and saving addresses) come in through props, never Firebase imports.
- Styling uses the theme CSS variables on `.shop` (`--s-surface`, `--s-ink`, `--s-blue`,
  `--s-radius`, …) in `src/components/shop/shop.css`, so staff restyle without a deploy. The
  existing mobile breakpoint is 640px.
- The submission document shape and `validSubmission` in `firestore.rules` do not change. Shipped
  orders still need the Google sign-in, postcode and quote (`validShipping`).
- Static export: no server rendering, so persisted state is read in effects after mount.
- The staff preview remembers nothing in the browser (`preview` prop) and is not full height; the
  panel must behave there too (positioned inside the preview box, as the old cart bar did).

## Approaches considered

**Where saved addresses live**

1. **Browser writes `customers/{uid}` at checkout (chosen).** When a signed-in customer places a
   shipped order the shop upserts their own document. Rules let a Google-signed-in user read and
   write only their own uid, with shape and length limits. Appears on the very next order, works
   in the sandbox with no functions, needs only a rules deploy.
2. Import function copies the address server-side when staff import the submission. Customers
   never write, but the address appears only after import, needs a functions deploy and a sandbox
   fake. Rejected for latency and deploy cost.
3. Derive from `customerOrders`. Rejected: those copies hold no address by design.

**Where checkout progress lives**

- `sessionStorage` (chosen): survives refresh and same-tab navigation, dies with the tab, which
  matches "saved in their session". The cart itself stays in `localStorage` as today, so a
  customer who comes back tomorrow keeps the items but starts checkout from the first step.
- `localStorage` with an expiry: more to get wrong (stale quotes, stale lane) for little gain.

**Modal versus route**

- A `<dialog>` modal (chosen), like the existing `Lightbox`: native focus trap and Escape, no
  extra route in the static export, the catalogue stays mounted behind it.
- A `/shop/checkout/` route: deep-linkable, but needs the cart and lane re-read and loses the
  "same page" feel the owner asked for.

## The design

### 1. Cart panel

Replaces the fixed bottom cart bar. One component, two layouts by the 640px breakpoint.

- **Desktop (wider than 640px):** fixed to the right edge, full viewport height, about 360px
  wide, its own scroll. Collapsed, only a handle remains: a small tab on the right edge, vertically
  centred, showing a single-colour cart icon (inline SVG, `currentColor`) and the item count.
  Expanded, the panel slides over the page; the page does not reflow. A "Keep shopping" button
  (or the handle) collapses it.
- **Mobile (640px and narrower):** a bottom sheet. Collapsed, only a puller at the bottom-right
  corner shows (cart icon and count, above the safe-area inset). Expanded, the sheet rises to at
  most about 70% of the viewport with its own scroll and a drag-free "Close" button.
- **Default state (builder's note, owner may override):** desktop opens the panel the first time
  the cart gains an item in a visit and otherwise leaves it as the customer left it; mobile starts
  collapsed. Open/closed is remembered in `sessionStorage`, never in preview mode.
- **Contents:** each line with name, variant, unit price, quantity stepper (same `Stepper`, same
  `maxQtyPerLine`), line total; unavailable lines with "Remove" and a "Remove unavailable items"
  button; items total; the lane label ("Preorder for X" / "Mail order"); a primary "Checkout"
  button, disabled while the cart is empty or has unavailable lines, with the reason in a hint.
  Empty cart: "Your cart is empty" and the handle shows 0.
- **Visibility:** the panel (and its handle) exists only while ordering is open (`choice` is set)
  and the thank-you page is not showing, as the old bar did.
- **Preview mode:** the preview box has no fixed height (`.shop.is-preview` is as tall as the
  catalogue), so the panel and handle are `position: sticky` there, as the old cart bar was, not
  fixed to the window and not absolutely positioned.

Text sketch, desktop expanded:

```
┌──────────────────────────────┐
│ Cart · Preorder for CF24     │
│ Acrylic stand · Blue   2  ▲▼ │
│   Rp45.000 each      Rp90.000│
│ Sticker sheet          1  ▲▼ │
│   Rp15.000 each      Rp15.000│
│ ───────────────────────────  │
│ Items                Rp105.000│
│ [ Checkout ]  Keep shopping  │
└──────────────────────────────┘
```

### 2. Checkout modal

A `<dialog>` opened from the panel's Checkout button. Closing it (Escape, backdrop, "Close")
keeps every step's state; reopening returns to the same step.

**Step indicator** across the top: one horizontal line from left to right with one circle per
step in *this* flow (three or four). Completed circles are filled with the accent, the current
circle is the filled one with a thicker ring, future circles are hollow; the line is filled up to
the current circle. No text labels in the indicator. Each circle has screen-reader text
("Your details, step 2 of 4"); completed circles are buttons that jump back.

**Navigation:** "Back" and "Continue" under each step; the last step's button is
"Place preorder · Rp…" / "Place mail order · Rp…". Continue validates only the current step and
shows errors inline, as the current checkout does. A step cannot be entered until the ones before
it are valid; the indicator only lets the customer jump backwards.

**Step 1 — Pick up or mail.** Shown only on preorder lanes (`choice.lane.kind === 'preorder'`).
Two option cards: "Pick up at the booth · At {eventName}" and "Ship after the event · Pay
shipping now; sent after the event ends". Mail-order lanes skip this step and fix
`fulfilment = 'mail'`. Preorder lanes default to pick-up.

**Step 2 — Your details.** Always shown.
- Name, e-mail, phone (WhatsApp preferred), notes (optional). Honeypot field as today.
- Pick-up: the pick-up day select when the lane lists days.
- Mail: in this order, under the contact fields:
  1. Google sign-in block (existing `ShopShipping` sign-in state) until signed in; signing in
     fills empty name and e-mail from the account.
  2. Saved addresses (only when signed in and the customer has any): a radio list, most recently
     used first, each showing postcode and the address text, plus a "New address" option; a
     "Forget" link per saved address. Picking one fills only the postcode and address fields
     below, which stay editable; the contact name and phone above are never touched. Editing a
     filled field switches the list to "New address" (the edited text is saved as its own entry
     at the end).
  3. Postcode (5 digits), then the Lion options with price and delivery estimate and "charged as
     N kg" (existing `ShopShipping` quote states), then the address textarea.
  4. The ship rule line (`shipRule`) and, on mail-order lanes, the "ships after current events
     end" note.
- Continue requires name, valid e-mail, phone; pick-up day when days exist; for mail, the same
  `shippingProblem` checks (signed in, quote ready, service chosen) and a non-empty address.
- A line under the address: "We remember this address for your next order. You can forget it
  any time."

**Step 3 — Review (read-only).** Items with quantities and line totals; items total; shipping
line (service, billed kg), handling and packaging when shipped; grand total. Then "How you get
it" (pick-up at event, day / ship to: address, postcode, service) and "Your details" (name,
e-mail, phone, notes). Each block has a small "Edit" link that jumps to its step. No inputs.

**Step 4 — Payment.** Payment method radios from `catalog.paymentChoices` plus the disabled
"Online payment · Coming soon"; `catalog.paymentText` under them; the receipt file input
(JPG, PNG or PDF, up to 10 MB), **required**: the place-order button is disabled and a hint says
"Upload your transfer receipt to place the order" until a file is chosen. After a refresh the step
shows "Choose your receipt again; files cannot be kept across a reload." The hint about preorders
being paid before the event / shipping after confirmation stays. The requirement is enforced in
the page only; `paymentProofUrl` stays optional in the rules because payment choices are free
text set by staff and the only method that would not need a receipt is disabled.

**Placing the order** builds the same `ShopDraft` as today and calls `onSubmit(choice, draft,
proof)`. On success: close the dialog, clear the cart and the saved checkout state, remember the
address (shipped orders), show the existing thank-you page. On failure: stay on step 4 with the
existing error line.

### 3. Checkout state across refresh

`sessionStorage` key `tsu.shop.checkout` holds `{ laneId, step, fulfilment, name, email, phone,
day, notes, postal, address, service, pay, open }` (the address text included, so a new or edited
address survives a refresh; the picker's selection is derived from whether postcode and text match a
saved entry, so no id is stored). Written on every change, read once after
mount; ignored when `laneId` differs from the current lane or in preview mode; cleared on
successful submit. The shipping quote is not stored: the hook re-quotes from the stored postcode
(quotes are cached server-side for 24 h, so this is usually a cache hit). `open` restores whether
the modal was showing. The receipt file is never stored.

### 4. Saved addresses

**Data.** Firestore `customers/{uid}` (uid = the Google account's auth uid):

```
{
  addresses: [ { id: string, postalCode: string, address: string, lastUsedAt: number } ],  // max 5
  updatedAt: number
}
```

Most recently used first. Saving an address whose postcode and address text (trimmed,
whitespace-collapsed, case-insensitive) match an existing one updates that entry's `lastUsedAt`
instead of adding. Beyond five, the least recently used is dropped. Nothing else is stored: no
name, phone or e-mail (those are the customer's contact details, filled from the account and typed
each time), and no order data. A parcel for someone else is written into the address text.

**Rules.** New block in `firestore.rules`, "Public exception 7":

```
match /customers/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid
    && request.auth.token.firebase.sign_in_provider == 'google.com'
    && (request.method == 'delete' || validCustomerDoc(request.resource.data));
}
```

`validCustomerDoc` checks `keys().hasOnly(['addresses','updatedAt'])`, `addresses is list`,
`size() <= 5`, `updatedAt is number`, and each present element by index (rules cannot loop):
keys exactly `id, postalCode, address, lastUsedAt`; `str(id, 40)`,
`postalCode.matches('^[1-9][0-9]{4}$')`, `str(address, 600)`, `lastUsedAt is number`. Staff do
not need access and nothing on the staff side reads this, so `customers` is added to the exclusion
list of the staff catch-all rule at the end of the file.

**Code.** `src/lib/customerAddresses.ts`: the `SavedAddress` type, `normaliseAddressKey`,
`mergeAddress(list, addr, now)` (pure, unit-testable), and the Firestore `loadAddresses(uid)`,
`saveAddresses(uid, list)`. The pure parts have no Firebase import so the sandbox can share them.
The repo has no test runner and this change does not add one; `mergeAddress` is checked from a
scratch script with `node_modules/jiti`, as other pure logic in this repo has been.

**Wiring.** `ShippingDeps` (in `src/lib/shippingQuote.ts`) gains an optional
`addressBook?: { load: (uid) => Promise<SavedAddress[]>; save: (uid, list) => Promise<void> }`.
`src/app/shop/page.tsx` attaches it to the deps it gets from `useShippingDeps()`; `useShippingDeps`
itself stays as it is, because `/f/` and `/shop/orders/` use it too and the Forms page must not
change. The sandbox provides an in-memory one; the staff preview provides none (the picker simply
does not appear). The checkout loads the list
when the customer signs in (or is already signed in when step 2 opens) and saves after a
successful shipped order. "Forget" saves the list without that entry.

**Submission.** Unchanged: `customer.address` carries the address text, `postalCode` the
postcode; name and phone are the customer's as today. One name field; if the parcel goes to
someone else the customer writes it in the address text.

### 5. Sandbox and preview

- `/sandbox/shop/` keeps the fake sign-in and fake quotes and adds an in-memory address book
  seeded with one address, so the picker can be checked without Firebase.
- The staff Storefront preview renders the panel inside the preview box and the modal as today's
  checkout does (the dialog is fine inside the admin app). It still cannot place shipped orders.

### 6. Deploy

`firebase deploy --only firestore:rules` before hosting, as with every rules change, so the
first customer who signs in can write `customers/{uid}`.

## Left to the builder

- Splitting `Shop.tsx`: the panel and the checkout each in their own file under
  `src/components/shop/` is expected; the thank-you page and lightbox may move too.
- Exact widths, slide transitions (none under `prefers-reduced-motion`), handle and badge
  styling, z-index order with the lightbox and the contact form, the cart icon path.
- Copy for hints and error lines beyond those quoted above.
- Whether the saved-address list loads once per sign-in or once per modal open.
- Whether the staff preview shows the panel open or collapsed.
- How the "Edit" links on the review step look.
