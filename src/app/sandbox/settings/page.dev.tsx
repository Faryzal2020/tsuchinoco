'use client';

import NotificationsPanel from '@/components/settings/NotificationsPanel';
import BrowserReadsPanel from '@/components/settings/BrowserReadsPanel';
import { PageHeader } from '@/components/ui/Bits';

export default function SandboxSettings() {
  return (
    <>
      <PageHeader title="Settings (sandbox)">Only the order e-mail settings and the browser read counter; the rest of Settings needs Firebase.</PageHeader>
      <div className="max-w-[720px] grid gap-4"><NotificationsPanel /><BrowserReadsPanel /></div>
    </>
  );
}
