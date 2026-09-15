'use client';
import { useQuery } from '@tanstack/react-query';
import type { Activity, IndexedToken } from '@/lib/indexer/types';
export type StateResponse = {
  state: 'ready' | 'syncing' | 'unconfigured' | 'stale' | 'error';
  tokens: IndexedToken[];
  events: Activity[];
  eventCount?: number;
  stats: { received: string; processed: string } | null;
  block?: string;
  updatedAt?: string;
};
export type SystemStatus = {
  ready: boolean;
  storage: boolean;
  blockers: string[];
  limitations: string[];
  network: string;
  chainId: number;
  pons: string;
  forgeFactory: string | null;
  forgeAutomationExecutor: string | null;
  verification: string;
};
export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Data is temporarily unavailable.');
  return r.json();
}
export function useForgeState(page = 0) {
  return useQuery({
    queryKey: ['forge-state', page],
    queryFn: () => fetchJson<StateResponse>(`/api/state?page=${page}`),
    refetchInterval: 30_000,
  });
}
export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: () => fetchJson<SystemStatus>('/api/status'),
  });
}
