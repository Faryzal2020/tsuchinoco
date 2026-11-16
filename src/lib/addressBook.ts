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

/** Stored text: trimmed, runs of spaces collapsed, line breaks kept. */
const tidy = (s: string) => s.trim().replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');

/** Two addresses are the same when postcode and text match ignoring case and spacing. */
export function addressKey(postalCode: string, address: string): string {
  return `${postalCode.trim()}|${address.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/**
 * The list after shipping to `a` now: an existing match moves to the top, a new one is added, the
 * oldest beyond five drops. The entry just used always comes first, whatever this device's clock says.
 */
export function rememberAddress(list: SavedAddress[], a: { postalCode: string; address: string }, now: number, newId: () => string): SavedAddress[] {
  const key = addressKey(a.postalCode, a.address);
  const existing = list.find((x) => addressKey(x.postalCode, x.address) === key);
  const entry: SavedAddress = { id: existing?.id ?? newId(), postalCode: a.postalCode.trim(), address: tidy(a.address), lastUsedAt: now };
  const rest = list.filter((x) => x !== existing).sort((x, y) => y.lastUsedAt - x.lastUsedAt);
  return [entry, ...rest].slice(0, MAX_SAVED_ADDRESSES);
}

export function forgetAddress(list: SavedAddress[], id: string): SavedAddress[] {
  return list.filter((x) => x.id !== id);
}

/**
 * Remember `a` in the customer's book: the list is read again right before it is written, so a stale
 * or failed earlier read never overwrites what is stored. Returns the saved list, or null when the
 * read failed (nothing is written then).
 */
export async function rememberInBook(book: AddressBook, uid: string, a: { postalCode: string; address: string }, now: number, newId: () => string): Promise<SavedAddress[] | null> {
  let current: SavedAddress[];
  try { current = await book.load(uid); } catch { return null; }
  const next = rememberAddress(current, a, now, newId);
  await book.save(uid, next);
  return next;
}

/** Forget one address the same way: re-read, drop, write. Null when the read failed. */
export async function forgetInBook(book: AddressBook, uid: string, id: string): Promise<SavedAddress[] | null> {
  let current: SavedAddress[];
  try { current = await book.load(uid); } catch { return null; }
  const next = forgetAddress(current, id);
  await book.save(uid, next);
  return next;
}

/** The saved entry the typed postcode and text correspond to, if any. */
export function findAddress(list: SavedAddress[], postalCode: string, address: string): SavedAddress | undefined {
  const key = addressKey(postalCode, address);
  return list.find((x) => addressKey(x.postalCode, x.address) === key);
}
