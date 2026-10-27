'use client';

// Every preorder form in one place: publish, accepting on or off, link, preview.
import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { useImporter } from '@/components/SubmissionImporter';
import { formRepo } from '@/lib/repo';
import { createFormForBatch, formChangedSincePublish, publishForm } from '@/lib/formActions';
import { formUrl } from '@/lib/forms';
import { formatDate, formatDateTime } from '@/lib/format';
import Button from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Field';
import { Empty, PageHeader, Pill, StatusPill, TableWrap } from '@/components/ui/Bits';

export default function FormsPage() {
  const { me } = useAuth();
  const { events, batches, formsById, publicFormsById, itemsById, settings } = useData();
  const { pending } = useImporter();
  const { run, toast } = useToast();
  const [busy, setBusy] = useState('');

  const rows = useMemo(() => {
    const eventById = new Map(events.map((e) => [e.id, e]));
    return batches
      .map((b) => ({ batch: b, event: eventById.get(b.eventId), form: formsById.get(b.id), pub: publicFormsById.get(b.id) }))
      .filter((r) => r.event)
      .sort((a, b) => (b.event!.startDate || '').localeCompare(a.event!.startDate || '') || a.event!.name.localeCompare(b.event!.name) || a.batch.number - b.batch.number);
  }, [batches, events, formsById, publicFormsById]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => { setBusy(key); await run(fn, ok); setBusy(''); };

  return (
    <>
      <PageHeader title="Forms">One preorder form per batch. Publish after changing the offering or the layout; flip Accepting to pause without closing the batch.</PageHeader>
      {rows.length === 0 ? <Empty title="No batches yet">Create an event and its first batch; the form is created from the batch card.</Empty> : (
        <TableWrap>
          <thead><tr><th>Event · batch</th><th>Form</th><th>Published</th><th>Accepting</th><th>Link</th><th className="num">New</th><th /></tr></thead>
          <tbody>
            {rows.map(({ batch: b, event: e, form, pub }) => {
              const legacy = b.form?.provider === 'jotform';
              const changed = form ? formChangedSincePublish(form, b, itemsById) : false;
              const waiting = pending.filter((s) => s.batchId === b.id).length;
              const url = form ? formUrl(form.id) : legacy ? b.form!.url : '';
              return (
                <tr key={b.id}>
                  <td><span className="font-semibold">{e!.name}</span> <span className="text-ink-2">B{b.number}</span><span className="hint block"><StatusPill status={b.status} /> {e!.startDate && formatDate(e!.startDate)}</span></td>
                  <td>
                    {legacy ? <><Pill>JotForm (legacy)</Pill><span className="hint block">Needs Cloud Functions on Blaze.</span></> : form ? <>{form.title}<span className="hint block">{form.blocks.length} blocks · {b.offering.length} on offer</span></> : <span className="hint">No form yet</span>}
                  </td>
                  <td>
                    {form && (pub ? <><span className="whitespace-nowrap">{formatDateTime(pub.publishedAt)}</span><span className="hint block">v{pub.version}{changed && <Pill tone="yellow" className="ml-1">Changed since</Pill>}</span></> : <Pill>Draft</Pill>)}
                  </td>
                  <td>
                    {form && pub && <Checkbox label={pub.enabled ? 'On' : 'Off'} checked={pub.enabled} disabled={busy === `en:${b.id}`} onChange={(ev) => act(`en:${b.id}`, () => formRepo.setEnabled(form.id, ev.target.checked, true, me), ev.target.checked ? 'Accepting submissions' : 'Paused')} />}
                    {form && !pub && <span className="hint">Publish first</span>}
                  </td>
                  <td>
                    {url && (
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" onClick={() => { navigator.clipboard?.writeText(url); toast('Link copied'); }}>Copy link</Button>
                        <Button size="sm" variant="quiet" href={url} target="_blank" rel="noreferrer">Open</Button>
                      </div>
                    )}
                  </td>
                  <td className="num">{waiting > 0 ? <Pill tone="yellow">{waiting}</Pill> : '—'}</td>
                  <td className="text-right whitespace-nowrap">
                    {!form && !legacy && <Button size="sm" variant="primary" disabled={b.offering.length === 0} title={b.offering.length === 0 ? 'Pick the offering first' : undefined} busy={busy === `create:${b.id}`} onClick={() => act(`create:${b.id}`, () => createFormForBatch(b, e!, itemsById, me), 'Form created')}>Create form</Button>}
                    {form && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        <Button size="sm" href={`/forms/editor/?id=${form.id}`}>Edit layout</Button>
                        <Button size="sm" href={`/forms/preview/?id=${form.id}`}>Preview</Button>
                        <Button size="sm" variant={pub && !changed ? 'neutral' : 'primary'} busy={busy === `pub:${b.id}`} onClick={() => act(`pub:${b.id}`, () => publishForm(form, b, e!, itemsById, settings, pub, me), pub ? 'Republished' : 'Published')}>{pub ? 'Republish' : 'Publish'}</Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
      <p className="hint mt-3">Click <strong>Edit layout</strong> to customize blocks, reorder products, configure QRIS &amp; bank payment instructions, apply theme presets, and save templates in the Form Studio. Customers see changes on their next page load after a publish.</p>
    </>
  );
}
