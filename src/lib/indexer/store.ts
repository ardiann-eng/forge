import { readJson, writeJson } from '../server/storage';
import type { IndexStore, Snapshot } from './types';
export const fileStore: IndexStore = {
  load: () => readJson<Snapshot>('index.json'),
  save: (s) => writeJson('index.json', s),
};
