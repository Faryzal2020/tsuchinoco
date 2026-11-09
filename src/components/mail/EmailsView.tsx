'use client';

// The Emails page body: one row with the Inbox tab and its inbox picker, the Broadcast tab and
// Mail settings, then the chosen tab. Shared by /emails/ and the localhost sandbox.
import React, { useState } from 'react';
import Link from 'next/link';
import { useData } from '@/lib/data';
import { useQuery } from '@/lib/useQuery';
import { inboxOf, mailSettingsOf } from '@/lib/mail';
import { useMail } from './MailContext';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import BroadcastTab from '@/components/email/BroadcastTab';
import Inbox from './Inbox';
import MailSettingsModal from './MailSettingsModal';

export default function EmailsView({ basePath }: { basePath: string }) {
  const { settings } = useData();
  const { get, set } = useQuery();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tab = get('tab') === 'broadcast' ? 'broadcast' : 'inbox';
  const mail = useMail();
  const m = mailSettingsOf(settings);
  const inboxes = mail.inboxes;
  const unread = (a: string) => mail.threads.filter((t) => t.folder === 'inbox' && t.unread && inboxOf(t, m) === a).length;
  const inbox = inboxes.includes(get('inbox')) ? get('inbox') : inboxes[0];
  const inboxHref = inbox === inboxes[0] ? basePath : `${basePath}?inbox=${encodeURIComponent(inbox)}`;

  return (
    <>
      <div className="tabs mb-3 items-center flex-wrap gap-y-1 overflow-visible">
        <Link href={inboxHref} className="tab" aria-current={tab === 'inbox' ? 'page' : undefined}>Inbox</Link>
        <label className="shrink-0">
          <span className="sr-only">Inbox to show</span>
          <Select
            small
            className="w-auto max-w-[170px] sm:max-w-[240px]"
            value={inbox}
            onChange={(e) => set({ inbox: e.target.value === inboxes[0] ? null : e.target.value, tab: null, folder: null, thread: null, message: null }, false)}
          >
            {inboxes.map((a) => { const n = unread(a); return <option key={a} value={a} title={a}>{mail.inboxNames[a] || a}{n ? ` (${n})` : ''}</option>; })}
          </Select>
        </label>
        <Link href={`${basePath}?tab=broadcast`} className="tab sm:ml-2" aria-current={tab === 'broadcast' ? 'page' : undefined}>Broadcast</Link>
        <div className="ml-auto shrink-0 pl-3"><Button size="sm" onClick={() => setSettingsOpen(true)}>Mail settings</Button></div>
      </div>
      {tab === 'inbox' ? <Inbox inbox={inbox} /> : <BroadcastTab onOpenSettings={() => setSettingsOpen(true)} />}
      <MailSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
