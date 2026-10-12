# Data model and rules

Condensed from the design spec. This is the reference for what each Firestore collection holds and how the computed numbers on screen are derived. Field types are TypeScript as in `src/types/index.ts`.

## Concepts

| Term | Meaning |
| --- | --- |
| Item | A catalogue entry. One product manager, one price, one type. |
| Variant | A sellable version of an item. Every item has at least one; items without real variants use the hidden variant id `default`. Stock, orders, planning, and counts always refer to a variant. |
| Bundle | An item of kind `bundle` with its own price and component variants. Ordered as one line, expanded to components for stock, price allocated across components. |
| Event | A real-world sales event. Two never run at once, but preorder windows may overlap. |
| Batch | A numbered preorder window inside an event with an offering and one JotForm. Batch 3 is usually the post-event, mail-only batch. |
| Order | One form submission (or a manual entry). Pickup or mail. Raw lines as the customer saw them plus expanded lines per variant. |
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
| `variants` | `{ id, name, active }[]` | Products only. Empty means one implicit `default` variant. Ids never change. |
| `components` | `{ itemId, variantId, qty, allocatedPrice? }[]` | Bundles only |
| `notes` | string | |

### `events/{id}`

| Field | Type |
| --- | --- |
| `name`, `venue`, `notes` | string |
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
| `form` | map? | `{ provider: 'jotform', formId, url, fieldMap, customerFields, generatedAt }`. `fieldMap` maps a JotForm question id to a variant key or a bundle item id. Written by the functions. |
| `planning` | map | Keyed by variant key: `{ onsiteExtra, ordered, received }`. All manual inputs. |

### `orders/{id}`

| Field | Type | Notes |
| --- | --- | --- |
| `eventId`, `batchId` | string | |
| `source` | `jotform` \| `manual` \| `web` | |
| `externalId` | string | JotForm submission id. Re-delivered webhooks update the same document. |
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

One rule for every document: allowed when the request carries an email claim and `staff/{email}` exists with `active == true`. There is no per-collection logic. The JotForm API key is a Cloud Functions secret, never in Firestore, because every staff member can read every document.

## JotForm integration

- **Generate form** builds one JotForm from the batch offering: name, email, phone, a pickup-or-mail radio (omitted for post batches), an address textarea, then one numeric quantity field per offered variant or bundle, grouped under a header per item type. Question `name`s are deterministic (`v_<itemId>_<variantId>`, `b_<itemId>`) so a later re-sync can diff by name. The function then registers the webhook and writes `form.fieldMap` to the batch.
- **Webhook** receives `formID` and `submissionID`, fetches the submission from the API, builds raw lines from every quantity field above zero at the current item price, expands bundles, and creates or updates the order by `externalId`.
- **Re-import** fetches all submissions for the form and runs the same path. Safe to repeat.
- **Re-sync fields** adds quantity fields for new offering entries and deletes fields for removed ones. Customer fields are never touched.

A future website form can read the batch offering and submit to a function that reuses the import path with `source = 'web'`.
