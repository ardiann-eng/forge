import { isAddress } from 'viem';
import { getStrategies } from '@/lib/forge/strategies-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address))
    return Response.json({ state: 'error', error: 'Invalid token address.' }, { status: 400 });
  try {
    const result = await getStrategies(address);
    return new Response(
      JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { state: 'error', error: 'Strategy state could not be verified. Retry shortly.' },
      { status: 503 },
    );
  }
}
