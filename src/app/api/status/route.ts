import { NextResponse } from 'next/server';
import { forgeFactory, deploymentBlock, writesEnabled, chain } from '@/lib/config';
import { ponsConfigured, integrationLimitations, manifest } from '@/lib/pons/config';
export const dynamic = 'force-dynamic';
export async function GET() {
  const storage =
    !!process.env.PINATA_JWT && (process.env.UPLOAD_SESSION_SECRET?.length || 0) >= 32;
  const blockers = [
    ...(!storage ? ['Configure IPFS storage and upload authentication.'] : []),
    ...(!forgeFactory ? ['Deploy and configure ForgeRouterFactory.'] : []),
    ...(deploymentBlock === null ? ['Set the Forge deployment block and run the indexer.'] : []),
    ...(!writesEnabled ? ['Mainnet writes are disabled.'] : []),
    ...(!ponsConfigured ? ['Configure the verified PONS network and factory.'] : []),
  ];
  return NextResponse.json({
    ready: !blockers.length,
    storage,
    blockers,
    limitations: integrationLimitations,
    network: chain.name,
    chainId: chain.id,
    pons: manifest.address,
    forgeFactory,
    verification: manifest.verification,
  });
}
