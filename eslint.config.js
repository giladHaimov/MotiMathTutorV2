// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/dist/**',
      'apps/web/android/**',
      'apps/web/ios/**',
      'db/migrations/**',
      'design-docs/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    // The pure engine must not import framework/DB/React code.
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fastify', message: 'engine must stay pure (no framework imports)' },
            { name: 'pg', message: 'engine must stay pure (no database imports)' },
            { name: 'drizzle-orm', message: 'engine must stay pure (no database imports)' },
            { name: 'react', message: 'engine must stay pure (no UI imports)' },
          ],
        },
      ],
    },
  },
  prettier,
);
