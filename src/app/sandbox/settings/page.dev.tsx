'use client';

import NotificationsPanel from '@/components/settings/NotificationsPanel';
import { PageHeader } from '@/components/ui/Bits';

export default function SandboxSettings() {
  return (
    <>
      <PageHeader title="Settings (sandbox)">Only the order e-mail settings; the rest of Settings needs Firebase.</PageHeader>
      <div className="max-w-[720px]"><NotificationsPanel /></div>
    </>
  );
}
