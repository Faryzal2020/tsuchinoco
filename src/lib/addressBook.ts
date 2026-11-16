// Saved shipping addresses for a Google-signed-in customer: the merge rules behind customers/{uid}.
// Pure: no Firebase or React, shared by the shop, the sandbox and the check script.

export interface SavedAddress {
  id: string;
  postalCode: string;
  address: string;
  /** When the customer last shipped to it; the list is kept most recent first. */
  lastUsedAt: number;
}

/** Where the list lives: Firestore on the live shop, memory in the sandbox, nothing in the staff preview. */
export interface AddressBook {
  load: (uid: string) => Promise<SavedAddress[]>;
  save: (uid: string, list: SavedAddress[]) => Promise<void>;
}

export const MAX_SAVED_ADDRESSES = 5;

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Two addresses are the same when postcode and text match ignoring case and spacing. */
export function addressKey(postalCode: string, address: string): string {
  return `${postalCode.trim()}|${tidy(address).toLowerCase()}`;
}

/** The list after shipping to `a` now: an existing match moves to the top, a new one is added, the oldest beyond five drops. */
export function rememberAddress(list: SavedAddress[], a: { postalCode: string; address: string }, now: number, newId: () => string): SavedAddress[] {
  const key = addressKey(a.postalCode, a.address);
  const entry: SavedAddress = { id: '', postalCode: a.postalCode.trim(), address: tidy(a.address), lastUsedAt: now };
  const existing = list.find((x) => addressKey(x.postalCode, x.address) === key);
  const next = existing
    ? list.map((x) => (x === existing ? { ...entry, id: x.id } : x))
    : [...list, { ...entry, id: newId() }];
  return next.sort((x, y) => y.lastUsedAt - x.lastUsedAt).slice(0, MAX_SAVED_ADDRESSES);
}

export function forgetAddress(list: SavedAddress[], id: string): SavedAddress[] {
  return list.filter((x) => x.id !== id);
}

/** The saved entry the typed postcode and text correspond to, if any. */
export function findAddress(list: SavedAddress[], postalCode: string, address: string): SavedAddress | undefined {
  const key = addressKey(postalCode, address);
  return list.find((x) => addressKey(x.postalCode, x.address) === key);
}
