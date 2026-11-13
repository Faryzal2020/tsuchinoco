'use client';

// Order history for a customer signed in with Google: every order they placed for shipping while
// signed in. Reads customerOrders where uid is theirs; the rules allow nothing wider.
import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { COL } from '@/lib/repo';
import { orderPagePath } from '@/lib/customerOrders';
import { useShippingDeps } from '@/lib/customerAuth';
import CustomerOrderHistory from '@/components/shop/CustomerOrderHistory';
import type { CustomerOrder } from '@/types';
import '@/components/shop/shop.css';

export default function OrdersPage() {
  const deps = useShippingDeps();
  const uid = deps.customer?.uid;
  const [orders, setOrders] = useState<{ token: string; order: CustomerOrder }[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname === 'admin.tsuchinoco.xyz') window.location.replace('https://tsuchinoco.xyz/shop/orders/');
    document.title = 'My orders';
  }, []);

  useEffect(() => {
    if (!uid || !isFirebaseConfigured) { setOrders(null); return; }
    return onSnapshot(query(collection(db, COL.customerOrders), where('uid', '==', uid)),
      (s) => setOrders(s.docs.map((d) => ({ token: d.id, order: d.data() as CustomerOrder }))),
      (e) => { console.error('[orders]', e); setError('Could not load your orders. Try again later.'); });
  }, [uid]);

  return <CustomerOrderHistory deps={deps} orders={orders} error={error} hrefFor={(t) => orderPagePath(t)} shopHref="/shop/" />;
}
