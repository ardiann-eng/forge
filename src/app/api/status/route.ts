import { NextResponse } from 'next/server';
import { forgeAutomationExecutor, forgeFactory, deploymentBlock, forgeFactoryV2, deploymentBlockV2, writesEnabled, chain } from '@/lib/config';
import { ponsConfigured, integrationLimitations, manifest } from '@/lib/pons/config';
export const dynamic = 'force-dynamic';
export async function GET() {
  const storage =
    !!process.env.PINATA_JWT && (process.env.UPLOAD_SESSION_SECRET?.length || 0) >= 32;
  const blockers = [
    ...(!storage ? ['Configure IPFS storage and upload authentication.'] : []),
    ...(!forgeFactoryV2 || deploymentBlockV2===null ? ['Deploy and configure ForgeRouterFactoryV2 and its indexer start block.'] : []),
    ...(!forgeAutomationExecutor ? ['Deploy and configure the FORGE automation executor.'] : []),
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
    forgeAutomationExecutor,
    verification: manifest.verification,
  });
}
