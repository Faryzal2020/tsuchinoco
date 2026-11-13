'use client';

// A customer form built from the sample preorder batch, as a preorder (pickup or ship) or as a
// post-event form (always ships). Sign-in is faked and prices are made up; the last submission is
// shown below instead of being saved.
import { useMemo, useState } from 'react';
import FormRenderer, { type SubmissionDraft } from '@/components/form/FormRenderer';
import { sandboxQuote, useSandbox } from '@/components/sandbox/SandboxProvider';
import { buildPublicForm, newFormDoc } from '@/lib/forms';
import type { ShippingCustomer, ShippingDeps } from '@/lib/shippingQuote';
import type { Batch, FormDoc, PublicForm } from '@/types';

const SANDBOX_CUSTOMER: ShippingCustomer = { uid: 'sbx-customer', name: 'Sandbox Customer', email: 'customer@example.com' };

export default function SandboxForm() {
  const { state } = useSandbox();
  const [mode, setMode] = useState<Batch['mode']>('preorder');
  const [customer, setCustomer] = useState<ShippingCustomer | null>(null);
  const [last, setLast] = useState<SubmissionDraft | null>(null);

  const pf = useMemo<PublicForm | null>(() => {
    const base = state.batches.find((b) => b.mode === 'preorder' && b.offering.length > 0);
    const event = base && state.events.find((e) => e.id === base.eventId);
    if (!base || !event) return null;
    const batch: Batch = { ...base, mode };
    const itemsById = new Map(state.items.map((i) => [i.id, i]));
    const form: FormDoc = { id: `sbx_form_${mode}`, ...newFormDoc(batch, event, itemsById), enabled: true, createdAt: 0, updatedAt: 0, updatedBy: '' };
    return { id: form.id, ...buildPublicForm(form, batch, event, itemsById, new Map(), state.settings, 1) };
  }, [state.batches, state.events, state.items, state.settings, mode]);

  const shipping = useMemo<ShippingDeps>(() => ({
    customer,
    signIn: async () => { setCustomer(SANDBOX_CUSTOMER); return SANDBOX_CUSTOMER; },
    quote: (r) => sandboxQuote(pf ?? undefined, state.settings, r),
  }), [customer, pf, state.settings]);

  if (!pf) return <p>No preorder batch with an offering in the sample data.</p>;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Form type</span>
        <button type="button" className={`btn btn-sm ${mode === 'preorder' ? 'btn-primary' : ''}`} onClick={() => setMode('preorder')}>Preorder (pickup or ship)</button>
        <button type="button" className={`btn btn-sm ${mode === 'post' ? 'btn-primary' : ''}`} onClick={() => setMode('post')}>Post-event (ships)</button>
        {customer && <button type="button" className="btn btn-sm ml-auto" onClick={() => setCustomer(null)}>Sign the customer out</button>}
      </div>
      <FormRenderer key={mode} form={pf} shipping={shipping} onSubmit={async (draft) => { setLast(draft); }} />
      {last && (
        <div>
          <h2 className="font-bold text-sm mb-1">Last submission (not saved)</h2>
          <pre className="text-xs bg-white border border-line rounded p-3 overflow-auto" data-testid="last-submission">{JSON.stringify(last, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
