import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';

// Standalone workers do not receive Next.js environment loading automatically.
nextEnv.loadEnvConfig(process.cwd());
const [{ syncIndex }, { fileStore }, { dataDir }] = await Promise.all([
  import('../src/lib/indexer/worker'),
  import('../src/lib/indexer/store'),
  import('../src/lib/server/storage'),
]);
await mkdir(dataDir, { recursive: true });
const lock = path.join(dataDir, 'indexer.lock');
const handle = await open(lock, 'wx').catch(() => {
  throw new Error('Indexer lock exists. Ensure no worker is running before removing a stale lock.');
});
let running = true;
process.on('SIGINT', () => {
  running = false;
});
process.on('SIGTERM', () => {
  running = false;
});
try {
  do {
    let failed = false;
    try {
      const snapshot = await syncIndex(fileStore);
      console.log(
        snapshot
          ? `Indexed through block ${snapshot.cursor}`
          : 'Waiting for deployment confirmation.',
      );
    } catch (e) {
      failed = true;
      console.error((e as Error).message);
      if (process.argv.includes('--once')) process.exitCode = 1;
    }
    if (!process.argv.includes('--once') && running) {
      const snapshot = await fileStore.load();
      // Catch up without an artificial delay; use the normal polling interval once current.
      // Back off after RPC failures even while catching up. Without this, a
      // rate-limit response creates a tight retry loop that prevents recovery.
      if (failed || snapshot?.caughtUp) await new Promise((r) => setTimeout(r, 15000));
    }
  } while (running && !process.argv.includes('--once'));
} finally {
  await handle.close();
  await unlink(lock);
}
