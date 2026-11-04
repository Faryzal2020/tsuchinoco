'use client';

import Shop from '@/components/shop/Shop';
import { useSandbox } from '@/components/sandbox/SandboxProvider';

export default function SandboxShop() {
  const { state, placeShopOrder } = useSandbox();
  if (!state.catalog) return null;
  return (
    <Shop
      catalog={state.catalog}
      status={state.storeStatus}
      docs={state.lanes}
      prices={state.publicPrices}
      onSubmit={async (_choice, draft) => { placeShopOrder(draft); }}
    />
  );
}
