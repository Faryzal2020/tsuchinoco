'use client';

// One order for its customer, opened from the link in the order e-mails (?t=<token>). Reads only
// customerOrders/{token}; no sign-in needed, the token is the secret.
import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { COL } from '@/lib/repo';
import { QueryPage, useQuery } from '@/lib/useQuery';
import { ORDER_HISTORY_PATH } from '@/lib/customerOrders';
import CustomerOrderCard from '@/components/shop/CustomerOrderCard';
import type { CustomerOrder } from '@/types';
import '@/components/shop/shop.css';

function OrderPage() {
  const { get } = useQuery();
  const token = get('t');
  const [order, setOrder] = useState<CustomerOrder | null | undefined>(undefined);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname === 'admin.tsuchinoco.xyz') {
      window.location.replace(`https://tsuchinoco.xyz/shop/order/${window.location.search}`);
    }
  }, []);

  useEffect(() => {
    if (!token || !isFirebaseConfigured) { setOrder(null); return; }
    return onSnapshot(doc(db, COL.customerOrders, token),
      (s) => setOrder(s.exists() ? (s.data() as CustomerOrder) : null),
      (e) => { console.error('[order]', e); setOrder(null); });
  }, [token]);

  useEffect(() => { document.title = order?.orderNumber ? `Order ${order.orderNumber}` : 'Your order'; }, [order?.orderNumber]);

  return (
    <div className="shop">
      <nav className="shop-head" aria-label="Shop">
        <a className="shop-nav-link" href="/shop/">Back to the shop</a>
        <a className="shop-nav-link" href={ORDER_HISTORY_PATH}>My orders</a>
      </nav>
      {order === undefined ? <p className="shop-hint">Loading your order…</p> : order === null ? (
        <section className="shop-thanks">
          <h2>Order not found</h2>
          <p>This link does not open an order. Check that you copied the whole link from the e-mail, or contact us with your order number.</p>
        </section>
      ) : <CustomerOrderCard order={order} />}
    </div>
  );
}

export default function Page() {
  return <QueryPage><OrderPage /></QueryPage>;
}
