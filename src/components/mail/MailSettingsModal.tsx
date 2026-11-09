'use client';

// Mail settings: inbox names, the addresses, the sending limits, the Resend key and the block list.
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { settingsRepo } from '@/lib/repo';
import { adminAddress, automatedAddress, mailSettingsOf } from '@/lib/mail';
import Button from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Dialog';
import { useMail } from './MailContext';

const LOCAL_RE = /^[a-z0-9._+-]+$/i;

export default function MailSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings } = useData();
  const { me } = useAuth();
  const { run } = useToast();
  const mail = useMail();
  const [f, setF] = useState(() => formOf(settings));
  const [names, setNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setF(formOf(settings)); setNames({ ...mail.inboxNames }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const renamed = mail.inboxes.filter((a) => (names[a] ?? '').trim() && (names[a] ?? '').trim() !== (mail.inboxNames[a] ?? ''));

  const daily = Number(f.dailyLimit);
  const monthly = Number(f.monthlyLimit);
  const problems = [
    !f.domain.trim().includes('.') && 'Enter the domain, such as tsuchinoco.xyz.',
    !LOCAL_RE.test(f.adminLocalPart.trim()) && 'The shared address name may only use letters, numbers and . _ + -',
    !LOCAL_RE.test(f.automatedLocalPart.trim()) && 'The automatic address name may only use letters, numbers and . _ + -',
    !(Number.isInteger(daily) && daily > 0) && 'The daily limit must be a whole number above 0.',
    !(Number.isInteger(monthly) && monthly >= daily) && 'The monthly limit must be a whole number at least the daily limit.',
  ].filter(Boolean) as string[];

  const save = async () => {
    const mailCfg = {
      domain: f.domain.trim().toLowerCase(),
      adminLocalPart: f.adminLocalPart.trim().toLowerCase(),
      automatedLocalPart: f.automatedLocalPart.trim().toLowerCase(),
      fromName: f.fromName.trim() || 'Tsuchinoco',
      dailyLimit: daily,
      monthlyLimit: monthly,
      blockedSenders: [...new Set(f.blocked.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))],
    };
    setSaving(true);
    const ok = await run(async () => {
      // Names live in Resend (they are also the From name), so they are saved there one by one.
      for (const a of renamed) await mail.renameInbox(a, names[a].trim());
      await settingsRepo.save({ ...settings, mail: mailCfg, resendApiKey: f.apiKey.trim() }, me);
    }, 'Mail settings saved');
    setSaving(false);
    if (ok) onClose();
  };

  const preview = mailSettingsOf({ mail: { domain: f.domain.trim() || 'example.com', adminLocalPart: f.adminLocalPart.trim() || 'admin', automatedLocalPart: f.automatedLocalPart.trim() || 'orders' } });
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '<project-id>';

  return (
    <Modal open={open} onClose={onClose} title="Mail settings" wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} busy={saving} disabled={problems.length > 0}>Save</Button></>}>
      <div className="space-y-5">
        <section>
          <div className="label">Inbox names</div>
          <p className="hint mb-2">Shown in the inbox picker and used as the From name on that inbox&apos;s e-mails. Inboxes themselves are added in Resend.</p>
          <div className="grid gap-2">
            {mail.inboxes.map((a) => (
              <label key={a} className="grid items-center gap-1 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-3">
                <span className="font-mono text-xs text-ink-2 break-all">{a}</span>
                <Input small value={names[a] ?? ''} placeholder="Name, e.g. Tsuchinoco Support" maxLength={80} onChange={(e) => setNames({ ...names, [a]: e.target.value })} />
              </label>
            ))}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Sender name for broadcasts and order updates" hint="Replies from an inbox use that inbox's name above."><Input value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} /></Field>
          <Field label="Domain" hint="Verified for sending and receiving in Resend."><Input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} /></Field>
          <Field label="Shared address" hint={`Sends and receives: ${adminAddress(preview)}. Must be the Resend inbox.`}><Input value={f.adminLocalPart} onChange={(e) => setF({ ...f, adminLocalPart: e.target.value })} /></Field>
          <Field label="Automatic address" hint={`Order updates come from ${automatedAddress(preview)}; replies go to the shared address.`}><Input value={f.automatedLocalPart} onChange={(e) => setF({ ...f, automatedLocalPart: e.target.value })} /></Field>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="E-mails a day" hint="Resend free plan: 100. Received mail counts too."><Input inputMode="numeric" value={f.dailyLimit} onChange={(e) => setF({ ...f, dailyLimit: e.target.value })} /></Field>
          <Field label="E-mails a month" hint="Resend free plan: 3,000."><Input inputMode="numeric" value={f.monthlyLimit} onChange={(e) => setF({ ...f, monthlyLimit: e.target.value })} /></Field>
        </section>

        <Field label="Resend API key" hint="Starts with re_. Leave empty to use RESEND_API_KEY from functions/.env instead.">
          <Input type="password" autoComplete="off" className="font-mono text-xs" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} />
        </Field>

        <Field label="Blocked senders" hint="One per line: a full address, or @domain.com for a whole domain. Their mail goes straight to Spam.">
          <Textarea rows={4} className="font-mono text-xs" value={f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.value })} />
        </Field>

        <div className="rounded-lg border border-line bg-cream px-3 py-2 text-xs text-ink-2 space-y-1">
          <p><b className="text-ink">Resend webhook</b>: point it at <span className="font-mono break-all">https://asia-southeast1-{project}.cloudfunctions.net/mailWebhook</span> with the events inbox.email.received, inbox.email.sent, inbox.thread.folder_updated, email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained, email.failed and email.suppressed.</p>
          <p>Its signing secret goes in functions/.env as RESEND_WEBHOOK_SECRET, never here.</p>
        </div>

        {problems.length > 0 && <ul className="text-sm text-red-ink list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      </div>
    </Modal>
  );
}

function formOf(settings: Parameters<typeof mailSettingsOf>[0] & { resendApiKey?: string }) {
  const m = mailSettingsOf(settings);
  return {
    fromName: m.fromName, domain: m.domain, adminLocalPart: m.adminLocalPart, automatedLocalPart: m.automatedLocalPart,
    dailyLimit: String(m.dailyLimit), monthlyLimit: String(m.monthlyLimit), apiKey: settings.resendApiKey ?? '', blocked: m.blockedSenders.join('\n'),
  };
}
