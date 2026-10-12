# Data model and rules

Condensed from the design spec. This is the reference for what each Firestore collection holds and how the computed numbers on screen are derived. Field types are TypeScript as in `src/types/index.ts`.

## Concepts

| Term | Meaning |
| --- | --- |
| Item | A catalogue entry. One product manager, one price, one type. |
| Variant | A sellable version of an item. Every item has at least one; items without real variants use the hidden variant id `default`. Stock, orders, planning, and counts always refer to a variant. |
| Bundle | An item of kind `bundle` with its own price and component variants. Ordered as one line, expanded to components for stock, price allocated across components. |
| Event | A real-world sales event. Two never run at once, but preorder windows may overlap. |
| Batch | A numbered preorder window inside an event with an offering and one form. Batch 3 is usually the post-event, mail-only batch. |
| Form | The in-house preorder form of a batch: layout blocks, theme, labels. One per batch, so one per event window; it can never move to another event. |
| Public form | The published, self-contained snapshot of a form that customers read. |
| Submission | What a customer wrote on the public form, before staff import turns it into an order. |
| Media | A small image (item thumbnail, header picture) stored inline in Firestore until Cloud Storage is available. |
| Order | One imported submission (or a manual entry). Pickup or mail. Raw lines as the customer saw them plus expanded lines per variant. Carries the sequential order ID `<eventcode>_<batch>_<seq>`. |
| Stock movement | One signed quantity change for one variant with a reason. On hand is the running sum. |
| Committed | Units promised to orders that are not yet collected, shipped, or cancelled, across all events. |
| Available | On hand minus committed. The number planning uses. |
| Wrap-up | The post-event count. One shared document per event. |

A variant key is the string `itemId:variantId`. It is used as a map key in `batches.planning` and `wrapups.rows`, and those maps are updated with `FieldPath` because the key contains a colon.

## Collections

Every document also carries `createdAt`, `updatedAt` (ms since epoch) and `updatedBy` (staff id). Prices are whole integers.

### `staff/{email}`

Document id is the lower-cased Google email. An active document is the entire access control.

| Field | Type |
| --- | --- |
| `email` | string, same as id |
| `displayName` | string |
| `active` | boolean |

### `items/{id}`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | |
| `kind` | `product` \| `bundle` | |
| `type` | string | One of `settings.itemTypes`; bundles use `bundle` |
| `managerId` | string | Staff id |
| `price` | number | Current selling price |
| `cost` | number? | Optional unit cost for margin |
| `producedAt` | string | Free-text note, replaces the vendor sheet |
| `active` | boolean | Inactive items are hidden from new offerings |
| `thumbnailId` | string? | `media` document shown on forms |
| `variants` | `{ id, name, active, sku?, price?, otsPrice?, priceJpy?, thumbnailId? }[]` | Products only. Empty means one implicit `default` variant. Ids never change. A variant thumbnail overrides the item's on forms. |
| `components` | `{ itemId, variantId, qty, allocatedPrice? }[]` | Bundles only |
| `notes` | string | |

### `events/{id}`

| Field | Type |
| --- | --- |
| `name`, `venue`, `notes` | string |
| `code` | string, short upper-case code used in order IDs, e.g. `CF23`. Derived from the name when blank. |
| `startDate`, `endDate` | `YYYY-MM-DD` |
| `status` | `upcoming` \| `wrapped` |
| `pickupDeadlineDays` | number, copied from settings at creation |

### `batches/{id}`

| Field | Type | Notes |
| --- | --- | --- |
| `eventId` | string | |
| `number` | number | 1, 2, 3 … |
| `mode` | `preorder` \| `post` | Post is mail-only |
| `status` | `draft` \| `open` \| `closed` \| `fulfilled` | Only one batch per event may be open |
| `opensAt`, `closesAt` | `YYYY-MM-DD` or `''` | Informational |
| `offering` | `{ itemId, variantId? }[]` | Bundles have no variantId. Order of the array is the order of fields on the form. |
| `form` | map? | `{ provider: 'inhouse', formId, url, generatedAt }` where `formId` equals the batch id and points at `forms/{formId}`. Legacy batches may still carry `{ provider: 'jotform', formId, url, fieldMap, customerFields, generatedAt }`. |
| `planning` | map | Keyed by variant key: `{ onsiteExtra, ordered, received }`. All manual inputs. |

### `orders/{id}`

| Field | Type | Notes |
| --- | --- | --- |
| `eventId`, `batchId` | string | |
| `source` | `jotform` \| `manual` \| `web` | `web` is the in-house form |
| `externalId` | string | `submissions` document id for `web`, JotForm submission id for `jotform`, empty for `manual` |
| `transactionId` | string? | Sequential order ID `<eventcode>_<batch>_<seq>` (e.g. `CF23_1_0002`), one per payment. Allocated from `counters/{batchId}` in a transaction. |
| `pickupDay` | string? | Chosen pickup day label, pickup orders only |
| `submittedAt` | number | From the form |
| `customer` | `{ name, email, phone, address? }` | |
| `fulfilment` | `pickup` \| `mail` | |
| `status` | see state machine below | |
| `rawLines` | `{ itemId, variantId?, qty, unitPrice, lineTotal }[]` | As ordered; bundles are one line |
| `lines` | `{ itemId, variantId, qty, unitPrice, fromBundleItemId? }[]` | Expanded per variant; everything stock-related reads this |
| `total` | number | Sum of raw lines |
| `contact` | `{ contactedAt, note }`? | Uncollected-pickup conversation |
| `returnToStockBy` | `YYYY-MM-DD`? | Set when the order becomes not collected |
| `collectedAt`, `shippedAt`, `cancelledAt` | number? | |
| `notes` | string | |

### `stockMovements/{id}`

| Field | Type | Notes |
| --- | --- | --- |
| `itemId`, `variantId` | string | |
| `qty` | number | Signed |
| `reason` | `opening` \| `received` \| `pickup` \| `walkin` \| `shipped` \| `correction` \| `reversal` | |
| `eventId`, `batchId`, `orderId` | string? | Whichever applies |
| `note` | string | |
| `createdAt`, `createdBy` | | Movements have no `updatedAt`; they are append-only |

### `wrapups/{eventId}`

| Field | Type | Notes |
| --- | --- | --- |
| `status` | `draft` \| `finalized` | |
| `rows` | map keyed by variant key | `{ brought, leftover, editedBy }`, both counts nullable |
| `bundlesSold` | map keyed by bundle item id | count sold on site |
| `finalizedAt`, `finalizedBy` | | |
| `movementIds` | string[] | Movements this wrap-up posted, so un-finalising reverses exactly those |

### `media/{id}`

Images without Cloud Storage. Staff-only. Resized in the browser before saving: thumbnails to 240 px, header images to 1200 px.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `thumbnail` \| `image` | |
| `mime` | string | `image/jpeg` or `image/png` |
| `dataUrl` | string | The image itself |
| `width`, `height`, `bytes` | number | |
| `name` | string | Original file name |
| `createdAt`, `createdBy` | | Media documents are never updated, only replaced |

### `forms/{batchId}`

The editable form definition. Staff-only. The id equals the batch id, which is what ties a form to exactly one batch and one event forever.

| Field | Type | Notes |
| --- | --- | --- |
| `eventId`, `batchId` | string | Never change |
| `title` | string | |
| `theme` | `{ background, surface, accent, text, font, width, radius }` | Colours as hex, `font` one of `sans` \| `serif` \| `rounded`, `width` one of `narrow` \| `normal` \| `wide`, `radius` one of `sharp` \| `soft` \| `round` |
| `blocks` | `FormBlock[]` | Ordered layout, see below |
| `labels` | map | Every customer-facing string: field labels, button text, section titles. Bilingual defaults. |
| `settings` | map | `{ pickupDays: string[], maxQtyPerLine, requirePhone, requireEmail, thankYouMessage, closedMessage }` |
| `enabled` | boolean | Desired accepting state; mirrored to the public snapshot on publish and when the batch opens or closes |
| `publishedAt` | number? | Last publish |
| `publishedHash` | string? | Hash of the published definition, to show "changed since publish" |

Block types (`type` plus fields):

| Type | Fields | Notes |
| --- | --- | --- |
| `header` | `title, subtitle, imageId?` | |
| `text` | `text` | Plain text, blank lines separate paragraphs. No HTML. |
| `image` | `imageId, caption?, size: full \| half` | |
| `divider` | | |
| `section` | `title, description?` | |
| `products` | `title?, source, layout: list \| grid, showThumbnails, showPrices` | `source` is `{ kind: 'type', type }`, `{ kind: 'bundles' }`, `{ kind: 'all' }`, or `{ kind: 'entries', keys: string[] }`. Resolved against the batch offering at publish time. |
| `customer` | | Name, email, phone |
| `fulfilment` | | Pickup or mail, pickup day, address. Omitted automatically on post batches (mail only). |
| `notes` | | Free text from the customer |
| `submit` | | Button |

### `publicForms/{batchId}`

The published snapshot. **Readable by anyone**, written by staff. Contains everything the customer page needs so that the catalogue, orders, and stock stay private. Images are inlined as data URLs; the whole document must stay under 1 MiB.

| Field | Type | Notes |
| --- | --- | --- |
| `formId`, `eventId`, `batchId` | string | |
| `enabled` | boolean | `false` shows the closed message |
| `mode` | `preorder` \| `post` | |
| `title`, `theme`, `labels`, `settings` | | Copied from the form |
| `currency` | string | From settings |
| `blocks` | `PublicBlock[]` | Same as form blocks, except `products` blocks carry resolved `products` and image blocks carry `src` |
| `items` | map keyed by offering key | `{ name, variantName, price, kind }`. The offering key is the variant key for products and the item id for bundles. Submission rules check line keys against this map. |
| `maxQtyPerLine` | number | Copied for the rules |
| `publishedAt`, `version` | number | `version` increments on every publish |

A resolved product: `{ key, itemId, variantId?, name, variantName, price, thumb? }`, grouped per item in the block so variants render under one card.

### `submissions/{id}`

Written by the customer from the public page. Rules allow `create` only, for any signed-in user (customers sign in anonymously), with shape validation against `publicForms/{formId}`. Staff read and update.

| Field | Type | Notes |
| --- | --- | --- |
| `formId`, `eventId`, `batchId` | string | Must match the public form |
| `version` | number | Public form version the customer saw |
| `code` | string | Short confirmation code shown to the customer |
| `customer` | `{ name, email, phone, address? }` | |
| `fulfilment` | `pickup` \| `mail` | |
| `pickupDay` | string? | |
| `notes` | string | |
| `lines` | `{ key, qty }[]` | Keys must exist in `publicForms.items`; `qty` an integer 1 … `maxQtyPerLine` |
| `submittedAt` | number | Client clock; rules accept any number, import keeps it |
| `status` | `new` \| `imported` \| `rejected` | Must be `new` on create |
| `orderId` | string? | Set on import |
| `rejectReason` | string? | Staff note when rejected |

### `counters/{batchId}`

`{ next: number }`. Staff-only. Read and incremented inside the same transaction that creates an order, so two staff importing at once cannot produce the same sequence number.

### `formTemplates/{id}` (phase 2)

`{ name, theme, blocks, labels, settings, isDefault }`. Blocks keep unresolved product sources so a template applies to any offering.

### `settings/global`

| Field | Type |
| --- | --- |
| `currency` | string, display only |
| `itemTypes` | string[] |
| `pickupDeadlineDays` | number |

## Computed values

None of these are stored. They live in `src/lib/compute.ts`.

### Stock

```
onHand(v)    = Σ stockMovements.qty            where variant = v
committed(v) = Σ orders.lines.qty              where variant = v
               and order.status ∈ { awaiting_pickup, not_collected, awaiting_shipment }
available(v) = onHand(v) − committed(v)
```

Committed is counted across every event, which is what makes overlapping preorder windows safe.

### Planning row (batch B of event E)

```
preorderPickup(v) = Σ lines.qty over orders in B, fulfilment = pickup, status ≠ cancelled
preorderMail(v)   = Σ lines.qty over orders in B, fulfilment = mail,   status ≠ cancelled
incoming(v)       = Σ (ordered − received) over the other batches of E
netToOrder(v)     = max(0, preorderPickup + preorderMail + onsiteExtra − available − incoming)
```

Confirming a `received` value posts a `received` movement for the difference since the previous value.

### Wrap-up row

```
pickupsCollected(v) = Σ lines.qty over orders in E, status = collected
walkinSold(v)       = brought(v) − leftover(v) − pickupsCollected(v)
```

Finalising posts one `pickup` and one `walkin` movement per variant (negative), moves every `awaiting_pickup` order of the event to `not_collected` with `returnToStockBy = endDate + pickupDeadlineDays`, locks the counts, and sets the event to `wrapped`. Un-finalising writes `reversal` movements for exactly the ids in `movementIds`.

### Bundle price allocation

```
listTotal    = Σ component.qty × item(component).price
allocated(c) = component.allocatedPrice                       if set
             = round(bundle.price × item(c).price / listTotal)  otherwise
rounding remainder goes to the last component so Σ allocated × qty = bundle.price
```

### Walk-in revenue with bundles

```
bundleUnits(v) = Σ bundlesSold[b] × qty of v in b
looseUnits(v)  = walkinSold(v) − bundleUnits(v)        must be ≥ 0
walkinRevenue  = Σ bundlesSold[b] × price(b) + Σ looseUnits(v) × price(v)
```

### Event report

```
preorderRevenue(channel) = Σ order.total   where eventId = E, status ≠ cancelled, grouped by pickup / mail / post-batch mail
produced(v)              = Σ received across batches of E
sold(v)                  = pickupsCollected(v) + walkinSold(v) + Σ shipped lines of orders in E
leftoverValue(v)         = leftover(v) × price(v)
margin(v)                = revenue(v) − sold(v) × cost(v)      only when cost is set
```

## State machines

Batch:

```
draft ──▶ open ──▶ closed ──▶ fulfilled
                     └──▶ open (reopen)
```

Order, pickup:

```
awaiting_pickup ──▶ collected
       └──▶ not_collected ──▶ shipped     (customer paid shipping; address added)
                  └──▶ cancelled           (deadline passed or declined; commitment released)
```

Order, mail:

```
awaiting_shipment ──▶ shipped
        └──▶ cancelled
```

`shipped` posts a negative `shipped` movement per line. `cancelled` posts nothing; it only releases the commitment.

## Security rules

Staff rule for every document: allowed when the request carries an email claim and `staff/{email}` exists with `active == true`. Two public exceptions exist for the customer form:

- `publicForms/{id}`: anyone may read.
- `submissions/{id}`: any signed-in user (anonymous sign-in included) may create one document whose shape passes validation: the referenced public form exists and is enabled, every line key is in its `items` map, quantities are integers within the limit, strings are bounded, `status` is `new`, and no other fields are present. Nobody but staff can read, update, or delete submissions.

Everything else stays staff-only. Customers never read the catalogue, orders, or stock.

## In-house form

- **Create form** (batch card) writes `forms/{batchId}` with a default layout built from the batch: header, intro text, customer block, fulfilment block (preorder batches only), one products block per item type present in the offering plus one for bundles, notes, submit. Labels default to the circle's bilingual wording. Pickup days default to each day of the event.
- **Publish** resolves product blocks against the current offering and catalogue (names, variant names, prices with offering overrides, thumbnails), inlines images, checks the size, and writes `publicForms/{batchId}` with `version + 1`. Publishing again after editing the offering or layout is the equivalent of the old "Re-sync fields".
- **Accepting** is `enabled` on the public snapshot. Opening a batch turns it on, closing turns it off; the Forms page can toggle it independently.
- **Customer page** `/f/?id={batchId}` reads only the public snapshot, renders it with the theme, validates locally, signs in anonymously, and creates one `submissions` document. The thank-you screen shows the confirmation code and a summary.
- **Import** runs in the staff app while it is open: a listener on `submissions` with `status == 'new'` processes each one in a transaction: read the counter, read the submission (must still be `new`), build raw lines at the offering price for that key, expand bundles, write the order with `source: 'web'`, `externalId` = submission id, `transactionId` from the counter, mark the submission `imported` with the order id. Unknown keys are skipped; a submission with no valid lines is marked `rejected`.
- **Manual orders** take the next sequence number from the same counter.
- A legacy batch with `provider: 'jotform'` still shows its JotForm link; its generation and import functions need Cloud Functions, which require the Blaze plan. See `docs/ROADMAP.md`.
