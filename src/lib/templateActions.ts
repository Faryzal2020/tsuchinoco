'use client';

import { templateRepo } from './repo';
import { newId } from './keys';
import type { FormBlock, FormDoc, FormTemplate } from '@/types';

/** Re-generates block IDs so copying a layout creates unique block references. */
export function rekeyBlocks(blocks: FormBlock[]): FormBlock[] {
  return blocks.map((b) => ({ ...b, id: newId(6) }));
}

/** Saves the layout, theme, and settings of a form as a reusable template. */
export async function saveFormAsTemplate(
  form: FormDoc,
  name: string,
  description: string,
  isDefault: boolean,
  by: string,
): Promise<string> {
  return templateRepo.create(
    {
      name: name.trim(),
      description: description.trim() || undefined,
      theme: { ...form.theme },
      blocks: form.blocks.map((b) => ({ ...b })),
      labels: { ...(form.labels ?? {}) },
      settings: { ...form.settings },
      isDefault,
    },
    by,
  );
}

/** Applies a template's blocks, theme, labels, and settings to an existing form without altering its batch/event identity. */
export function applyTemplateToForm(form: FormDoc, template: FormTemplate): FormDoc {
  return {
    ...form,
    theme: { ...template.theme },
    blocks: rekeyBlocks(template.blocks),
    labels: { ...template.labels },
    settings: {
      ...form.settings,
      ...template.settings,
      // Retain the form's event-specific pickup days if the template doesn't specify any
      pickupDays: template.settings.pickupDays?.length ? [...template.settings.pickupDays] : form.settings.pickupDays,
    },
  };
}

/** 1-click clone layout, theme, and settings from a past event/batch form into the current form. */
export function cloneFormFromBatch(targetForm: FormDoc, sourceForm: FormDoc): FormDoc {
  return {
    ...targetForm,
    theme: { ...sourceForm.theme },
    blocks: rekeyBlocks(sourceForm.blocks),
    labels: { ...sourceForm.labels },
    settings: {
      ...sourceForm.settings,
      // Keep target form's event pickup days if available
      pickupDays: targetForm.settings.pickupDays?.length ? targetForm.settings.pickupDays : sourceForm.settings.pickupDays,
    },
  };
}
