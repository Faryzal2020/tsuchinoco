'use client';

import { useState } from 'react';
import OfferingPicker from '@/components/event/OfferingPicker';
import { PageHeader, Panel } from '@/components/ui/Bits';
import type { OfferingEntry } from '@/types';

export default function SandboxOffering() {
  const [offering, setOffering] = useState<OfferingEntry[]>([]);
  return (
    <>
      <PageHeader title="Batch offering (sandbox)">The picker from Events → Batches → Edit offering, on the sample catalogue. Nothing is saved.</PageHeader>
      <Panel className="max-w-[960px]"><OfferingPicker value={offering} onChange={setOffering} /></Panel>
    </>
  );
}
