'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAdmin } from './providers';

export default function AdminIndexPage() {
  const { staff, loading } = useAdmin();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(staff === null ? '/login' : '/compliance');
  }, [staff, loading, router]);

  return null;
}
