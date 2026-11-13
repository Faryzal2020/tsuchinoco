'use client';

import { useMemo, useState } from 'react';
import Shop from '@/components/shop/Shop';
import { useSandbox } from '@/components/sandbox/SandboxProvider';
import { useSandboxMail } from '@/components/sandbox/SandboxMail';
import { fx } from '@/lib/functions';
import type { ShippingCustomer, ShippingDeps } from '@/lib/shippingQuote';

const SANDBOX_CUSTOMER: ShippingCustomer = { uid: 'sbx-customer', name: 'Sandbox Customer', email: 'customer@example.com' };

export default function SandboxShop() {
  const { state, placeShopOrder } = useSandbox();
  const { addContact } = useSandboxMail();
  // Google sign-in is faked; quotes come from the sandbox's made-up Lion prices (fx.quoteShipping).
  const [customer, setCustomer] = useState<ShippingCustomer | null>(null);
  const shipping = useMemo<ShippingDeps>(() => ({
    customer,
    signIn: async () => { setCustomer(SANDBOX_CUSTOMER); return SANDBOX_CUSTOMER; },
    quote: (r) => fx.quoteShipping(r),
  }), [customer]);
  if (!state.catalog) return null;
  return (
    <Shop
      catalog={state.catalog}
      status={state.storeStatus}
      docs={state.lanes}
      prices={state.publicPrices}
      onSubmit={async (_choice, draft) => { placeShopOrder(draft); }}
      onContact={async (c) => { addContact(c); }}
      shipping={shipping}
    />
  );
}
