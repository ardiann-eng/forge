import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
// Runtime volume, never traced into the server bundle.
export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.INDEXER_DATA_DIR || 'data',
);
export async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(
      await readFile(
        /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dataDir, name),
        'utf8',
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export async function writeJson(name: string, value: unknown) {
  await mkdir(dataDir, { recursive: true });
  const target = path.join(/* turbopackIgnore: true */ dataDir, name);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(
    temp,
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
  await rename(temp, target);
}
