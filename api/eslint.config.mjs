import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // General
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Next.js
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ['tests/**/*.js'],
    rules: {
      // Plain-CommonJS jest bootstrap files (loaded by jest before TS transforms).
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "db/**",
      "coverage/**",
    ],
  },
];

export default eslintConfig;
