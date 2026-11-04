'use client';

import Link from 'next/link';
import { PageHeader, Panel } from '@/components/ui/Bits';

export default function SandboxHome() {
  return (
    <>
      <PageHeader title="Sandbox">Try the staff screens and the storefront without signing in. Every button works on sample data in this tab only.</PageHeader>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel><h2 className="font-bold mb-1"><Link className="text-blue-ink" href="/sandbox/orders/">Orders</Link></h2><p className="hint">Unfulfilled first, tabs per order type, payment, Mark delivered with tracking, mail-order hold.</p></Panel>
        <Panel><h2 className="font-bold mb-1"><Link className="text-blue-ink" href="/sandbox/storefront/">Storefront (staff)</Link></h2><p className="hint">What customers see and why, the mail-order switch and override, listed preorders, shop text.</p></Panel>
        <Panel><h2 className="font-bold mb-1"><Link className="text-blue-ink" href="/sandbox/shop/">Shop (customer)</Link></h2><p className="hint">Search, filters, cart and checkout. A placed order shows up in Orders.</p></Panel>
      </div>
    </>
  );
}
