'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SessionDetail, SessionsList } from '@/views/SessionsView';

function Sessions() {
  const id = useSearchParams().get('id');
  return id ? <SessionDetail key={id} id={id} /> : <SessionsList />;
}

export default function Page() {
  return <Suspense><Sessions /></Suspense>;
}
