'use client';

// The customer's "My orders" page on sandbox orders. Copies are built with customerOrderView,
// the function the Cloud Function uses for customerOrders/{token}; the order id stands in for
// the token. Sign-in is faked as the same customer the sandbox shop and form use.
import { useMemo, useState } from 'react';
import { useSandbox } from '@/components/sandbox/SandboxProvider';
import CustomerOrderHistory from '@/components/shop/CustomerOrderHistory';
import CustomerOrderCard from '@/components/shop/CustomerOrderCard';
import { customerOrderView } from '@/lib/customerOrders';
import type { ShippingCustomer, ShippingDeps } from '@/lib/shippingQuote';

const SANDBOX_CUSTOMER: ShippingCustomer = { uid: 'sbx-customer', name: 'Sandbox Customer', email: 'customer@example.com' };

export default function SandboxMyOrders() {
  const { state } = useSandbox();
  const [customer, setCustomer] = useState<ShippingCustomer | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const deps = useMemo<ShippingDeps>(() => ({
    customer,
    signIn: async () => { setCustomer(SANDBOX_CUSTOMER); return SANDBOX_CUSTOMER; },
    quote: async () => { throw new Error('Not used here'); },
  }), [customer]);
  const itemsById = useMemo(() => new Map(state.items.map((i) => [i.id, i])), [state.items]);
  const all = useMemo(() => state.orders.map((o) => ({
    token: o.id,
    order: customerOrderView(o, { event: state.events.find((e) => e.id === o.eventId), batch: state.batches.find((b) => b.id === o.batchId), itemsById, currency: state.settings.currency }),
  })), [state.orders, state.events, state.batches, itemsById, state.settings.currency]);
  const mine = customer ? all.filter((x) => x.order.uid === customer.uid) : null;
  const opened = all.find((x) => x.token === open);

  if (opened) {
    return (
      <div className="shop">
        <nav className="shop-head"><button type="button" className="shop-link" onClick={() => setOpen(null)}>Back to my orders</button></nav>
        <CustomerOrderCard order={opened.order} />
      </div>
    );
  }
  return <CustomerOrderHistory deps={deps} orders={mine} onOpen={setOpen} shopHref="/sandbox/shop/" />;
}
