'use client';

// Staff preview of a form built from the current draft and offering, without publishing.
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { QueryPage, useQuery } from '@/lib/useQuery';
import { previewPublicForm, publishForm } from '@/lib/formActions';
import { publicFormSize, PUBLIC_FORM_LIMIT } from '@/lib/forms';
import Button from '@/components/ui/Button';
import { Loading, PageHeader, Panel, Pill } from '@/components/ui/Bits';
import FormRenderer from '@/components/form/FormRenderer';
import type { PublicForm } from '@/types';

function Preview() {
  const { get } = useQuery();
  const id = get('id');
  const { me } = useAuth();
  const { formsById, batches, events, itemsById, settings, publicFormsById } = useData();
  const { run } = useToast();
  const form = formsById.get(id);
  const batch = batches.find((b) => b.id === id);
  const event = batch ? events.find((e) => e.id === batch.eventId) : undefined;
  const [snap, setSnap] = useState<Omit<PublicForm, 'id'> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!form || !batch || !event) return;
    let alive = true;
    previewPublicForm(form, batch, event, itemsById, settings).then((s) => { if (alive) setSnap(s); });
    return () => { alive = false; };
  }, [form, batch, event, itemsById, settings]);

  if (!form || !batch || !event) return <Panel>This form does not exist. <Button href="/forms/" variant="quiet" size="sm">Back to forms</Button></Panel>;
  const size = snap ? publicFormSize(snap) : 0;
  const pub = publicFormsById.get(id);

  return (
    <>
      <PageHeader eyebrow={`${event.name} · Batch ${batch.number}`} title={form.title}
        actions={<><Button href="/forms/">Back to forms</Button><Button href={`/events/view/?id=${event.id}&tab=batches`}>Batch</Button><Button variant="primary" busy={busy} onClick={async () => { setBusy(true); await run(() => publishForm(form, batch, event, itemsById, settings, pub, me), pub ? 'Republished' : 'Published'); setBusy(false); }}>{pub ? 'Republish' : 'Publish'}</Button></>}>
        This is what customers see after the next publish. {snap && <Pill tone={size > PUBLIC_FORM_LIMIT ? 'red' : 'neutral'}>{Math.round(size / 1024)} KB of {Math.round(PUBLIC_FORM_LIMIT / 1024)} KB</Pill>}
      </PageHeader>
      {!snap ? <Loading label="Building preview…" /> : (
        <div className="rounded-xl border border-line-strong overflow-hidden">
          <FormRenderer key={JSON.stringify(snap.blocks.length) + snap.publishedAt} form={snap} preview />
        </div>
      )}
    </>
  );
}

export default function Page() {
  return <QueryPage><Preview /></QueryPage>;
}
