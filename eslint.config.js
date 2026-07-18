import eslint from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'node_modules/**',
      'cypress/screenshots/**',
      'cypress/videos/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './packages',
              from: './apps/web',
              message: 'Packages must not import from applications.',
            },
            {
              target: './packages/protocol',
              from: './packages/simulation',
              message:
                'Protocol must not depend on simulation implementation details.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@torrevieja-tycoon/web',
                '@torrevieja-tycoon/web/*',
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                'three',
                'three/*',
                '@react-three/fiber',
                '@react-three/fiber/*',
                '@react-three/drei',
                '@react-three/drei/*',
                'zustand',
                'zustand/*',
                'dexie',
                'dexie/*',
                'vite-plugin-pwa',
                'vite-plugin-pwa/*',
                'socket.io',
                'socket.io/*',
                'socket.io-client',
                'socket.io-client/*',
                '@socket.io/*',
              ],
              message:
                'Environment-neutral packages must not import browser, UI, persistence, PWA, or networking adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'cypress/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.config.ts', '*.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
  },
);
