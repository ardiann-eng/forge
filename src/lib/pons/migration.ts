import type { Address } from 'viem';
import { getToken, phaseLabel } from './reads';
export async function getGraduationState(token: Address) {
  const t = await getToken(token);
  return {
    phase: t.phase,
    status: phaseLabel(t.phase),
    sweptQuote: t.sweptQuote,
    sweptAt: t.sweptAt,
  };
}
export const getMigrationState = getGraduationState;
