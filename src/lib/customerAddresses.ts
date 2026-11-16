'use client';

// The live shop's address book: customers/{uid} in Firestore, readable and writable only by that
// Google-signed-in customer (see firestore.rules). The merge rules are in addressBook.ts.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { COL } from './repo';
import type { AddressBook, SavedAddress } from './addressBook';

export const firestoreAddressBook: AddressBook = {
  load: async (uid) => {
    const snap = await getDoc(doc(db, COL.customers, uid));
    const list = snap.exists() ? (snap.data() as { addresses?: unknown }).addresses : undefined;
    return Array.isArray(list) ? (list as SavedAddress[]) : [];
  },
  save: async (uid, list) => {
    await setDoc(doc(db, COL.customers, uid), { addresses: list, updatedAt: Date.now() });
  },
};
