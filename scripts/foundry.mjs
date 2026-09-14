import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const executable =
  process.platform === 'win32' && existsSync('.tools/forge.exe') ? '.tools/forge.exe' : 'forge';
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) console.error('Install Foundry: https://getfoundry.sh', result.error.message);
process.exit(result.status ?? 1);
