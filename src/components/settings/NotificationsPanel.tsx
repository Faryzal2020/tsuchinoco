'use client';

// Order-update e-mails: one switch per update, which template it uses, and a preview with a
// sample order. The server (functions/src/orders.ts) queues them; the mail queue sends them through Resend.
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { settingsRepo } from '@/lib/repo';
import { NOTIFICATION_LABELS, NOTIFICATION_TYPES, notificationsOf, orderEmailVars, PLACEHOLDERS, renderEmail, templateFor } from '@/lib/orderEmail';
import type { NotificationSetting, NotificationType, Order } from '@/types';
import Button from '@/components/ui/Button';
import { Checkbox, Select } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Bits';

const SAMPLE: Order = {
  id: 'sample', eventId: '', batchId: '', source: 'store', externalId: '', transactionId: 'CF24_1_0042', submittedAt: Date.now(),
  customer: { name: 'Nadia Putri', email: 'nadia@example.com', phone: '' }, fulfilment: 'pickup', pickupDay: 'Day 2 (25 Nov 2026)', status: 'shipped',
  orderType: 'preorder', payment: 'paid', paymentMethod: 'Bank transfer', tracking: { courier: 'JNE', number: 'CGK0001122334' },
  rawLines: [], lines: [], total: 105000, notes: '', createdAt: Date.now(), updatedAt: Date.now(), updatedBy: '',
};

export default function NotificationsPanel() {
  const { settings, items, itemsById, events } = useData();
  const { me } = useAuth();
  const { run } = useToast();
  const [n, setN] = useState<Record<NotificationType, NotificationSetting>>(notificationsOf(settings));
  const [preview, setPreview] = useState<NotificationType | ''>('');
  useEffect(() => setN(notificationsOf(settings)), [settings]);

  const configured = !!settings.resendFromEmail?.trim();
  const save = () => run(() => settingsRepo.save({ currency: settings.currency, itemTypes: settings.itemTypes, pickupDeadlineDays: settings.pickupDeadlineDays, notifications: n }, me), 'Saved');

  // Preview with two real catalogue items when there are any.
  const sample = useMemo<Order>(() => {
    const pick = items.filter((i) => i.active).slice(0, 2);
    const rawLines = pick.length ? pick.map((i, k) => ({ itemId: i.id, variantId: i.variants[0]?.id ?? 'default', qty: k + 1, unitPrice: i.price, lineTotal: (k + 1) * i.price })) : [];
    return { ...SAMPLE, rawLines, total: rawLines.reduce((s, l) => s + l.lineTotal, 0) || SAMPLE.total };
  }, [items]);
  const event = events.find((e) => e.kind !== 'store' && e.status === 'upcoming');
  const rendered = preview ? renderEmail(templateFor(preview, { ...settings, notifications: n }), orderEmailVars(sample, { event, itemsById, currency: settings.currency })) : null;

  return (
    <Panel>
      <h2 className="font-bold mb-1">Order e-mails</h2>
      <p className="hint mb-3">Sent automatically by the server when an order changes. Every e-mail is listed on its order, where staff can also send it again.</p>
      {!configured && (
        <p className="mb-3 rounded-md bg-yellow-soft px-3 py-2 text-sm text-yellow-ink">
          They come from the automatic address with replies going to the shared inbox. Set the Resend key in Mail settings on the <Link href="/emails/" className="underline">Emails</Link> page first, or e-mails are recorded as not sent.
        </p>
      )}
      <div className="grid gap-3">
        {NOTIFICATION_TYPES.map((t) => (
          <div key={t} className="rounded-lg border border-line p-3 grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Checkbox label={NOTIFICATION_LABELS[t].title} checked={n[t].on} onChange={(e) => setN({ ...n, [t]: { ...n[t], on: e.target.checked } })} />
              <Button size="sm" variant="quiet" onClick={() => setPreview(preview === t ? '' : t)}>{preview === t ? 'Hide preview' : 'Preview'}</Button>
            </div>
            <p className="hint">{NOTIFICATION_LABELS[t].when}</p>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-2">Template</span>
              <Select small className="w-[260px]" value={n[t].templateId ?? ''} onChange={(e) => setN({ ...n, [t]: { ...n[t], templateId: e.target.value || undefined } })}>
                <option value="">Built-in text</option>
                {(settings.emailTemplates ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </label>
            {preview === t && rendered && (
              <div className="rounded-md border border-line bg-white p-3 text-sm">
                <div className="mb-2"><span className="hint">Subject </span><b>{rendered.subject}</b></div>
                <div className="email-preview" dangerouslySetInnerHTML={{ __html: rendered.html }} />
              </div>
            )}
          </div>
        ))}
        <p className="hint">Placeholders for your own templates: {PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}.</p>
        <div><Button variant="primary" onClick={save}>Save</Button></div>
      </div>
    </Panel>
  );
}
