import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', 'storage/**', 'drizzle/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts', 'apps/**', 'packages/**']),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@next/next/no-img-element': 'off',
    },
  },
  {
    // Mobile API boundary: route definitions and their Next mounts call domain services only. Data access,
    // authorization and transactions live in src/server/modules/** and src/server/auth/** (Phase 1, decision S2).
    files: ['src/app/api/v1/**/*.ts', 'src/server/api/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'drizzle-orm', message: 'API routes must call a domain service, not query the database.' }],
          patterns: [{ group: ['@/server/db/*', '@/server/db'], message: 'API routes must call a domain service, not query the database.' }],
        },
      ],
    },
  },
]);
