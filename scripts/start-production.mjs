import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(process.execPath, ['--import', 'tsx', 'scripts/indexer.ts'], {
    stdio: 'inherit',
    env: process.env,
  }),
];

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

children[0].on('exit', (code) => {
  stop();
  process.exitCode = code ?? 1;
});
children[1].on('exit', (code) => {
  if (!stopping) {
    console.warn(`Indexer worker exited with code ${code ?? 0}. Server continuing with on-demand API auto-sync.`);
  }
});
