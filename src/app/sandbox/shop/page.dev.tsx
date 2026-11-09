'use client';

import Shop from '@/components/shop/Shop';
import { useSandbox } from '@/components/sandbox/SandboxProvider';
import { useSandboxMail } from '@/components/sandbox/SandboxMail';

export default function SandboxShop() {
  const { state, placeShopOrder } = useSandbox();
  const { addContact } = useSandboxMail();
  if (!state.catalog) return null;
  return (
    <Shop
      catalog={state.catalog}
      status={state.storeStatus}
      docs={state.lanes}
      prices={state.publicPrices}
      onSubmit={async (_choice, draft) => { placeShopOrder(draft); }}
      onContact={async (c) => { addContact(c); }}
    />
  );
}
