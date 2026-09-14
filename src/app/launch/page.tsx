import type { Metadata } from 'next';
import { Launch } from '@/components/launch';
export const metadata: Metadata = { title: 'Launch token' };
export default function Page() {
  return <Launch />;
}
