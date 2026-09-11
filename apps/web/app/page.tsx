'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from './providers';
import { LoadingCard } from '@/components/shell';

export default function IndexPage() {
  const { account, loading } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(account === null ? '/login' : '/home');
  }, [account, loading, router]);

  return (
    <div className="mp-main">
      <LoadingCard />
    </div>
  );
}
