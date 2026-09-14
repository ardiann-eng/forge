import { isAddress } from 'viem';
import { notFound } from 'next/navigation';
import { TokenTerminal } from '@/components/token-terminal';

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return <TokenTerminal address={address} />;
}
