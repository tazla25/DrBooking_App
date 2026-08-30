// ESLint — flat config matching the repo's api/ style (ESLint 9/10):
// expo preset + no-console warning + unused-vars with ^_ placeholder pattern
// (TS rules scoped to TS files — the @typescript-eslint plugin is registered
// by the expo preset's typescript block for those files only).
import expoConfig from 'eslint-config-expo/flat.js';

export default [
  {
    ignores: ['node_modules/**', '.expo/**', 'coverage/**', 'expo-env.d.ts'],
  },
  ...expoConfig,
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Jest bootstrap + suites need the runner globals (mirrors api/ style).
    files: ['jest.setup.js', '**/__tests__/**/*.ts?(x)'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
];
