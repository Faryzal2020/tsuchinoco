'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { QueryPage, useQuery } from '@/lib/useQuery';

function RedirectToCatalogModal() {
  const { get } = useQuery();
  const router = useRouter();
  const id = get('id');
  const newKind = get('new');

  useEffect(() => {
    if (id) {
      router.replace(`/catalog/?edit=${id}`);
    } else if (newKind) {
      router.replace(`/catalog/?new=${newKind}`);
    } else {
      router.replace('/catalog/');
    }
  }, [id, newKind, router]);

  return <div className="py-16 text-center text-sm text-muted">Opening item in catalogue…</div>;
}

export default function Page() {
  return <QueryPage><RedirectToCatalogModal /></QueryPage>;
}
