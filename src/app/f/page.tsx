'use client';

// Public preorder form. Reads only publicForms/{id}; writes one submission. No staff gate.
import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, isFirebaseConfigured, storage } from '@/lib/firebase';
import { clean, COL } from '@/lib/repo';
import { applyLivePrices, DEFAULT_FORM_LABELS, DEFAULT_THEME } from '@/lib/forms';
import { QueryPage, useQuery } from '@/lib/useQuery';
import FormRenderer, { themeStyle, type SubmissionDraft } from '@/components/form/FormRenderer';
import type { PublicForm, PublicPrices } from '@/types';

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="pf" style={themeStyle(DEFAULT_THEME)}>
      <div className="pf-inner"><div className="pf-card"><div className="pf-title">{title}</div>{children && <p style={{ marginTop: 8 }}>{children}</p>}</div></div>
    </div>
  );
}

function CustomerForm() {
  const { get } = useQuery();
  const id = get('id');
  const [form, setForm] = useState<PublicForm | null | undefined>(undefined);
  // Live prices: a price change in the catalogue shows here within seconds, without a republish.
  // undefined = still loading; null = no list yet, so the published prices stand.
  const [prices, setPrices] = useState<PublicPrices | null | undefined>(undefined);

  useEffect(() => {
    if (!isFirebaseConfigured) { setPrices(null); return; }
    return onSnapshot(doc(db, COL.publicPrices, 'current'),
      (s) => setPrices(s.exists() ? (s.data() as PublicPrices) : null),
      (e) => { console.error('[prices]', e); setPrices(null); });
  }, []);

  useEffect(() => {
    if (!id || !isFirebaseConfigured) { setForm(null); return; }
    return onSnapshot(doc(db, COL.publicForms, id),
      (s) => setForm(s.exists() ? ({ id: s.id, ...(s.data() as Omit<PublicForm, 'id'>) }) : null),
      (e) => { console.error('[form]', e); setForm(null); });
  }, [id]);

  useEffect(() => { if (form?.title) document.title = form.title; }, [form?.title]);

  const live = useMemo(() => (form ? applyLivePrices(form, prices) : null), [form, prices]);

  if (form === undefined || prices === undefined) return <Message title="…" />;
  if (form === null || !live) return <Message title={DEFAULT_FORM_LABELS.notFound} />;

  const submit = async (draft: SubmissionDraft, proofFile?: File) => {
    if (!auth.currentUser) await signInAnonymously(auth);
    const subRef = doc(collection(db, COL.submissions));
    let paymentProofUrl: string | undefined = undefined;

    if (proofFile) {
      const safeName = proofFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storageRef = ref(storage, `submissions/${subRef.id}/${Date.now()}_${safeName}`);
      const snap = await uploadBytes(storageRef, proofFile, { contentType: proofFile.type });
      paymentProofUrl = await getDownloadURL(snap.ref);
    }

    const seen = Object.fromEntries(Object.keys(draft.lines).filter((k) => live.seen[k]).map((k) => [k, live.seen[k]]));
    await setDoc(subRef, {
      ...clean({ ...draft, paymentProofUrl, orderType: form.mode === 'post' ? 'mail_order' : 'preorder', seen }),
      createdAt: serverTimestamp(),
    });
  };

  return <FormRenderer key={form.version} form={live.form} onSubmit={submit} />;
}

export default function Page() {
  return <QueryPage><CustomerForm /></QueryPage>;
}
