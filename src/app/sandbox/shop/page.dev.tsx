'use client';

import { useMemo, useRef, useState } from 'react';
import Shop from '@/components/shop/Shop';
import { useSandbox } from '@/components/sandbox/SandboxProvider';
import { useSandboxMail } from '@/components/sandbox/SandboxMail';
import { fx } from '@/lib/functions';
import type { SavedAddress } from '@/lib/addressBook';
import type { ShippingCustomer, ShippingDeps } from '@/lib/shippingQuote';

const SANDBOX_CUSTOMER: ShippingCustomer = { uid: 'sbx-customer', name: 'Sandbox Customer', email: 'customer@example.com' };

export default function SandboxShop() {
  const { state, placeShopOrder } = useSandbox();
  const { addContact } = useSandboxMail();
  // Google sign-in is faked; quotes come from the sandbox's made-up Lion prices (fx.quoteShipping).
  const [customer, setCustomer] = useState<ShippingCustomer | null>(null);
  // Saved addresses live in memory for the page's life, seeded with one so the picker can be tried.
  const books = useRef<Record<string, SavedAddress[]>>({
    'sbx-customer': [{ id: 'sbx-a1', postalCode: '40115', address: 'Jl. Braga 1, Bandung', lastUsedAt: 1 }],
  });
  const shipping = useMemo<ShippingDeps>(() => ({
    customer,
    signIn: async () => { setCustomer(SANDBOX_CUSTOMER); return SANDBOX_CUSTOMER; },
    quote: (r) => fx.quoteShipping(r),
    addressBook: {
      load: async (uid) => books.current[uid] ?? [],
      save: async (uid, list) => { books.current[uid] = list; },
    },
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
