import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('src/lib/forge', { recursive: true });
for (const name of ['ForgeAutomationExecutor', 'PonsStrategyPrice', 'PonsMarketAdapterV2', 'ForgeRouterV2', 'ForgeRouterFactoryV2', 'ForgeRouter', 'ForgeRouterFactory', 'ForgeBuybackVault', 'ForgeHolderRewards', 'PonsMarketAdapter']) {
  const artifact = JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, 'utf8'));
  writeFileSync(
    `src/lib/forge/${name}.abi.ts`,
    `// Generated from forge build. Do not edit.\nexport const abi = ${JSON.stringify(artifact.abi)} as const;\n`,
  );
}
