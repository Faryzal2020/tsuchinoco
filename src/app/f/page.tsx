'use client';

// Public preorder form. Reads only publicForms/{id}; writes one submission. No staff gate.
import React, { useEffect, useState } from 'react';
import { addDoc, collection, doc, onSnapshot } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from '@/lib/firebase';
import { clean, COL } from '@/lib/repo';
import { DEFAULT_FORM_LABELS, DEFAULT_THEME } from '@/lib/forms';
import { QueryPage, useQuery } from '@/lib/useQuery';
import FormRenderer, { themeStyle, type SubmissionDraft } from '@/components/form/FormRenderer';
import type { PublicForm } from '@/types';

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

  useEffect(() => {
    if (!id || !isFirebaseConfigured) { setForm(null); return; }
    return onSnapshot(doc(db, COL.publicForms, id),
      (s) => setForm(s.exists() ? ({ id: s.id, ...(s.data() as Omit<PublicForm, 'id'>) }) : null),
      (e) => { console.error('[form]', e); setForm(null); });
  }, [id]);

  useEffect(() => { if (form?.title) document.title = form.title; }, [form?.title]);

  if (form === undefined) return <Message title="…" />;
  if (form === null) return <Message title={DEFAULT_FORM_LABELS.notFound} />;

  const submit = async (draft: SubmissionDraft) => {
    if (!auth.currentUser) await signInAnonymously(auth);
    await addDoc(collection(db, COL.submissions), clean(draft));
  };

  return <FormRenderer key={form.version} form={form} onSubmit={submit} />;
}

export default function Page() {
  return <QueryPage><CustomerForm /></QueryPage>;
}
