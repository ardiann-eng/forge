'use client';
import { useState, type ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors/injected';
import { walletConnect } from 'wagmi/connectors/walletConnect';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { chain } from '@/lib/config';
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const config = createConfig({
  chains: [chain],
  connectors: [injected(), ...(projectId ? [walletConnect({ projectId })] : [])],
  transports: { [chain.id]: http() },
  ssr: true,
});
export function Providers({ children }: { children: ReactNode }) {
  const [query] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={query}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
