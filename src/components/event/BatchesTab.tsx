'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/prefs';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { batchRepo, formRepo } from '@/lib/repo';
import { fx } from '@/lib/functions';
import { createFormForBatch, formChangedSincePublish, publishForm } from '@/lib/formActions';
import { formUrl } from '@/lib/forms';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Batch, BatchStatus, OfferingEntry } from '@/types';
import Button from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Empty, Panel, Pill, StatusPill } from '@/components/ui/Bits';
import { Confirm, Modal } from '@/components/ui/Dialog';
import OfferingPicker from './OfferingPicker';
import type { TabProps } from './types';

export default function BatchesTab({ event, batches, orders }: TabProps) {
  const { me } = useAuth();
  const { run } = useToast();
  const [busy, setBusy] = useState(false);

  const addBatch = async () => {
    const number = (batches.at(-1)?.number ?? 0) + 1;
    const prev = batches.at(-1);
    setBusy(true);
    await run(() => batchRepo.create({
      eventId: event.id, number, mode: number >= 3 ? 'post' : 'preorder', status: 'draft', opensAt: '', closesAt: '',
      offering: prev ? prev.offering : [], planning: {},
    }, me), `Batch ${number} added`);
    setBusy(false);
  };

  return (
    <div className="grid gap-5">
      {batches.length === 0 ? (
        <Empty title="No batches yet" action={<Button variant="primary" onClick={addBatch} busy={busy}>Add batch 1</Button>}>
          A batch is one preorder window with its own form. Pick what is on offer, create the form, then open the batch.
        </Empty>
      ) : batches.map((b) => <BatchCard key={b.id} event={event} batch={b} batches={batches} orderCount={orders.filter((o) => o.batchId === b.id).length} />)}
      {batches.length > 0 && (
        <div><Button onClick={addBatch} busy={busy}>Add batch {(batches.at(-1)?.number ?? 0) + 1}</Button> <span className="hint ml-2">The offering is copied from the previous batch.</span></div>
      )}
    </div>
  );
}

function BatchCard({ event, batch: b, batches, orderCount }: { event: TabProps['event']; batch: Batch; batches: Batch[]; orderCount: number }) {
  const { me } = useAuth();
  const { allowDelete } = usePrefs();
  const { items, itemsById, settings, formsById, publicFormsById } = useData();
  const { run, toast } = useToast();
  const [editOffering, setEditOffering] = useState(false);
  const [offering, setOffering] = useState<OfferingEntry[]>(b.offering);
  const [busy, setBusy] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const form = formsById.get(b.id);
  const pub = publicFormsById.get(b.id);
  const legacy = b.form?.provider === 'jotform';
  const changed = form ? formChangedSincePublish(form, b, itemsById) : false;

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => { setBusy(key); await run(fn, ok); setBusy(''); };

  const setStatus = (status: BatchStatus) => act(status, async () => {
    if (form) {
      // Opening publishes the form if it never was, and turns accepting on. Closing turns it off.
      if (status === 'open') { if (!pub || changed) await publishForm(form, b, event, itemsById, settings, pub, me, true); else await formRepo.setEnabled(form.id, true, true, me); }
      if (status === 'closed' || status === 'fulfilled') await formRepo.setEnabled(form.id, false, !!pub, me);
    } else if (legacy && b.form) {
      if (status === 'open') await fx.setFormStatus({ batchId: b.id, enabled: true });
      if (status === 'closed') await fx.setFormStatus({ batchId: b.id, enabled: false });
    }
    await batchRepo.patch(b.id, { status }, me);
  }, `Batch ${b.number} ${status}`);

  const otherOpen = batches.some((x) => x.id !== b.id && x.status === 'open');
  const offeringCount = b.offering.length;
  const offeringMissing = b.offering.filter((e) => !items.find((i) => i.id === e.itemId)).length;

  const saveOffering = () => act('offering', async () => {
    await batchRepo.patch(b.id, { offering }, me);
    setEditOffering(false);
  }, 'Offering saved');

  const removeBatch = () => act('delete', async () => {
    if (form) await formRepo.remove(form.id);
    await batchRepo.remove(b.id);
  }, 'Batch deleted');

  const url = form ? formUrl(form.id) : legacy ? b.form!.url : '';

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">Batch {b.number}</h2>
            <StatusPill status={b.status} />
            <Pill tone="blue">{b.mode === 'post' ? 'Post-event, mail only' : 'Preorder'}</Pill>
          </div>
          <div className="hint mt-1">{orderCount} orders · {offeringCount} on offer{offeringMissing > 0 && ` (${offeringMissing} refer to deleted items)`}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {b.status === 'draft' && <Button variant="primary" size="sm" onClick={() => setStatus('open')} busy={busy === 'open'} disabled={otherOpen || offeringCount === 0} title={otherOpen ? 'Another batch is open' : undefined}>Open batch</Button>}
          {b.status === 'open' && <Button variant="accent" size="sm" onClick={() => setConfirmClose(true)} busy={busy === 'closed'}>Close batch</Button>}
          {b.status === 'closed' && <Button size="sm" onClick={() => setStatus('fulfilled')} busy={busy === 'fulfilled'}>Mark fulfilled</Button>}
          {b.status === 'closed' && <Button size="sm" variant="quiet" onClick={() => setStatus('open')} busy={busy === 'open'} disabled={otherOpen}>Reopen</Button>}
          {orderCount === 0 && !legacy && (
            <Button
              size="sm"
              variant="danger"
              disabled={!allowDelete}
              title={!allowDelete ? 'Deletions disabled in Settings' : undefined}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Mode">
          <Select small value={b.mode} disabled={!!b.form} onChange={(e) => run(() => batchRepo.patch(b.id, { mode: e.target.value as Batch['mode'] }, me))}>
            <option value="preorder">Preorder (pickup or mail)</option>
            <option value="post">Post-event (mail only)</option>
          </Select>
        </Field>
        <Field label="Opens" hint="For reference only."><Input small type="date" value={b.opensAt} onChange={(e) => run(() => batchRepo.patch(b.id, { opensAt: e.target.value }, me))} /></Field>
        <Field label="Closes"><Input small type="date" value={b.closesAt} onChange={(e) => run(() => batchRepo.patch(b.id, { closesAt: e.target.value }, me))} /></Field>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-cream p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Offering</h3>
            <Button size="sm" onClick={() => { setOffering(b.offering); setEditOffering(true); }}>Edit offering</Button>
          </div>
          <p className="hint mt-1">{offeringCount === 0 ? 'Nothing selected yet.' : `${offeringCount} variants and bundles. Each becomes one row on the form, grouped by type.`}</p>
        </div>

        <div className="rounded-lg border border-line bg-cream p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">Form</h3>
            {!form && !legacy && (
              <Button size="sm" variant="primary" disabled={offeringCount === 0} busy={busy === 'create'} title={offeringCount === 0 ? 'Pick the offering first' : undefined} onClick={() => act('create', () => createFormForBatch(b, event, itemsById, me), 'Form created. Publish it when the offering is final.')}>Create form</Button>
            )}
            {form && (
              <div className="flex gap-2">
                <Button size="sm" href={`/forms/preview/?id=${form.id}`}>Preview</Button>
                <Button size="sm" variant={pub && !changed ? 'neutral' : 'primary'} busy={busy === 'publish'} onClick={() => act('publish', () => publishForm(form, b, event, itemsById, settings, pub, me), pub ? 'Republished' : 'Published')}>{pub ? 'Republish' : 'Publish'}</Button>
              </div>
            )}
            {legacy && (
              <div className="flex gap-2">
                <Button size="sm" busy={busy === 'sync'} onClick={() => act('sync', () => fx.syncForm({ batchId: b.id }), 'Form fields updated')}>Re-sync fields</Button>
                <Button size="sm" busy={busy === 'reimport'} onClick={() => act('reimport', async () => { const r = await fx.reimportBatch({ batchId: b.id }); toast(`Imported ${r.imported} new, updated ${r.updated}, skipped ${r.skipped}`); })}>Re-import</Button>
              </div>
            )}
          </div>
          {form ? (
            <div className="mt-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {pub ? <Pill tone={pub.enabled ? 'green' : 'yellow'}>{pub.enabled ? 'Published · accepting' : 'Published · paused'}</Pill> : <Pill>Draft, not published</Pill>}
                {pub && changed && <Pill tone="yellow">Changed since publish</Pill>}
              </div>
              <a className="text-blue-ink break-all block mt-2" href={url} target="_blank" rel="noreferrer">{url}</a>
              <div className="hint mt-1">{pub ? `Published ${formatDateTime(pub.publishedAt)} · v${pub.version} · ${Object.keys(pub.items).length} rows.` : 'Customers see nothing until the first publish. Opening the batch publishes it.'} Submissions become orders while the app is open.</div>
              <Button size="sm" variant="quiet" className="mt-1" onClick={() => { navigator.clipboard?.writeText(url); toast('Link copied'); }}>Copy link</Button>
            </div>
          ) : legacy ? (
            <div className="mt-2 text-sm">
              <Pill>JotForm (legacy)</Pill>
              <a className="text-blue-ink break-all block mt-2" href={url} target="_blank" rel="noreferrer">{url}</a>
              <div className="hint mt-1">Generated {formatDateTime(b.form!.generatedAt)}. Re-sync and re-import need the Cloud Functions, which need the Blaze plan.</div>
            </div>
          ) : <p className="hint mt-1">Builds the in-house preorder form from the offering. Edit the offering first.</p>}
        </div>
      </div>

      <Modal open={editOffering} onClose={() => setEditOffering(false)} title={`Batch ${b.number} offering`} wide
        footer={<><Button onClick={() => setEditOffering(false)}>Cancel</Button><Button variant="primary" onClick={saveOffering} busy={busy === 'offering'}>Save offering</Button></>}>
        {pub && <p className="mb-3 text-sm rounded-md bg-yellow-soft px-3 py-2 text-yellow-ink">This batch&apos;s form is published. After saving, publish again so customers see the new offering.</p>}
        {legacy && <p className="mb-3 text-sm rounded-md bg-yellow-soft px-3 py-2 text-yellow-ink">This batch uses a legacy JotForm. After saving, use Re-sync fields to push the change to JotForm.</p>}
        <OfferingPicker value={offering} onChange={setOffering} />
      </Modal>

      <Confirm open={confirmClose} onClose={() => setConfirmClose(false)} onConfirm={async () => { setConfirmClose(false); await setStatus('closed'); }} title={`Close batch ${b.number}?`} confirmLabel="Close batch">
        The form stops accepting submissions. You can reopen it later.{b.closesAt && ` Planned close date was ${formatDate(b.closesAt)}.`}
      </Confirm>
      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={removeBatch} title={`Delete batch ${b.number}?`} confirmLabel="Delete" danger>
        It has no orders.{form && ' Its form and public page are deleted too.'}
      </Confirm>
    </Panel>
  );
}
