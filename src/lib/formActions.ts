'use client';

// Staff-side actions on in-house forms: create for a batch, publish, toggle accepting.
import { batchRepo, formRepo } from './repo';
import { fetchManyMedia } from './media';
import { unweighedLabels } from './shipping';
import { assertPublicFormFits, buildPublicForm, formHash, formMediaIds, formUrl, newFormDoc } from './forms';
import type { Batch, Event, FormDoc, Item, PublicForm, Settings } from '@/types';

export async function createFormForBatch(batch: Batch, event: Event, itemsById: Map<string, Item>, by: string): Promise<string> {
  const formId = await formRepo.create(batch.id, newFormDoc(batch, event, itemsById), by);
  await batchRepo.patch(batch.id, { form: { provider: 'inhouse', formId, url: formUrl(formId), generatedAt: Date.now() } }, by);
  return formId;
}

/**
 * Resolve the draft against the offering and catalogue and write the public snapshot. Returns the
 * items without a weight when the form can ship (a post-event batch or a pick-up-or-ship block).
 */
export async function publishForm(form: FormDoc, batch: Batch, event: Event, itemsById: Map<string, Item>, settings: Settings, current: PublicForm | undefined, by: string, enabled = form.enabled): Promise<{ unweighed: string[] }> {
  const media = await fetchManyMedia(formMediaIds(form, batch, itemsById));
  const pf = buildPublicForm({ ...form, enabled }, batch, event, itemsById, media, settings, (current?.version ?? 0) + 1);
  assertPublicFormFits(pf);
  await formRepo.publish(form.id, pf, formHash({ ...form, enabled }, batch, itemsById, settings), by);
  const ships = batch.mode === 'post' || form.blocks.some((b) => b.type === 'fulfilment');
  return { unweighed: ships ? unweighedLabels(pf.items) : [] };
}

/** True when publishing now would produce something different from what customers see. */
export function formChangedSincePublish(form: FormDoc, batch: Batch, itemsById: Map<string, Item>, settings: Pick<Settings, 'storefront'>): boolean {
  if (!form.publishedAt) return true;
  return formHash(form, batch, itemsById, settings) !== form.publishedHash;
}

/** Build the snapshot without writing it, for the staff preview. */
export async function previewPublicForm(form: FormDoc, batch: Batch, event: Event, itemsById: Map<string, Item>, settings: Settings): Promise<Omit<PublicForm, 'id'>> {
  const media = await fetchManyMedia(formMediaIds(form, batch, itemsById));
  return buildPublicForm(form, batch, event, itemsById, media, settings, 0);
}
