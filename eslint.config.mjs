import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
export default defineConfig([
  ...next,
  ...ts,
  globalIgnores(['.next/**', 'out/**', 'lib/**', 'research/**', 'next-env.d.ts']),
  { rules: { '@next/next/no-img-element': 'off' } },
  {
    files: ['src/components/launch.tsx', 'src/components/ui.tsx'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
]);
