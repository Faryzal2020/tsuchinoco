'use client';

// Public storefront. Reads only public documents: the catalogue, the mail-order switch, the live
// price list and the storefront lanes. Writes one submission, validated by the same rules as the Forms.
import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, isFirebaseConfigured, storage } from '@/lib/firebase';
import { clean, COL } from '@/lib/repo';
import Shop, { type ContactDraft, type ShopDraft } from '@/components/shop/Shop';
import { useShippingDeps } from '@/lib/customerAuth';
import { ORDER_HISTORY_PATH } from '@/lib/customerOrders';
import type { PublicForm, PublicPrices, StoreCatalog, StoreStatus } from '@/types';

export default function ShopPage() {
  const [catalog, setCatalog] = useState<StoreCatalog | null | undefined>(undefined);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [prices, setPrices] = useState<PublicPrices | null>(null);
  const [docs, setDocs] = useState<Record<string, PublicForm | null>>({});
  const shipping = useShippingDeps();

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname === 'admin.tsuchinoco.xyz') {
      window.location.replace(`https://tsuchinoco.xyz/shop/${window.location.search}${window.location.hash}`);
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) { setCatalog(null); return; }
    const log = (n: string) => (e: Error) => console.error(`[shop] ${n}`, e);
    const u = [
      onSnapshot(doc(db, COL.publicStore, 'catalog'), (s) => setCatalog(s.exists() ? (s.data() as StoreCatalog) : null), (e) => { log('catalog')(e); setCatalog(null); }),
      onSnapshot(doc(db, COL.publicStore, 'status'), (s) => setStatus(s.exists() ? (s.data() as StoreStatus) : null), log('status')),
      onSnapshot(doc(db, COL.publicPrices, 'current'), (s) => setPrices(s.exists() ? (s.data() as PublicPrices) : null), log('prices')),
    ];
    return () => u.forEach((f) => f());
  }, []);

  const laneIds = useMemo(() => (catalog?.lanes ?? []).map((l) => l.id).sort().join(','), [catalog]);
  useEffect(() => {
    if (!laneIds) return;
    const u = laneIds.split(',').map((id) => onSnapshot(doc(db, COL.publicForms, id),
      (s) => setDocs((d) => ({ ...d, [id]: s.exists() ? ({ id: s.id, ...(s.data() as Omit<PublicForm, 'id'>) }) : null })),
      (e) => console.error('[shop] lane', id, e)));
    return () => u.forEach((f) => f());
  }, [laneIds]);

  useEffect(() => { if (catalog?.title) document.title = catalog.title; }, [catalog?.title]);

  if (catalog === undefined) return <div className="shop" />;
  if (catalog === null) {
    return (
      <div className="shop"><div className="shop-status shop-status-quiet"><b>The shop is not open yet</b><span>Check back soon.</span></div></div>
    );
  }

  const submit = async (_choice: unknown, draft: ShopDraft, proof?: File) => {
    if (!auth.currentUser) await signInAnonymously(auth);
    const subRef = doc(collection(db, COL.submissions));
    let paymentProofUrl: string | undefined;
    if (proof) {
      const safe = proof.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const snap = await uploadBytes(ref(storage, `submissions/${subRef.id}/${Date.now()}_${safe}`), proof, { contentType: proof.type });
      paymentProofUrl = await getDownloadURL(snap.ref);
    }
    await setDoc(subRef, { ...clean({ ...draft, paymentProofUrl }), createdAt: serverTimestamp() });
  };

  // The contact form writes one validated message; a function files it into the staff inbox.
  const contact = async (c: ContactDraft) => {
    if (!auth.currentUser) await signInAnonymously(auth);
    await setDoc(doc(collection(db, COL.contactSubmissions)), { ...clean(c), status: 'new', submittedAt: Date.now(), createdAt: serverTimestamp() });
  };

  return <Shop catalog={catalog} status={status} docs={docs} prices={prices} onSubmit={submit} onContact={contact} shipping={shipping} ordersHref={ORDER_HISTORY_PATH} />;
}
