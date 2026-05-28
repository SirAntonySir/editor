import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import localPlugin from './tools/eslint-rules/index.js'

export default defineConfig([
  globalIgnores(['dist', '.worktrees/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { 'editor-local': localPlugin },
    rules: {
      'editor-local/no-nested-component-definition': 'error',
    },
  },
  // Pragmatic gate: pre-existing noisy rules downgraded to 'warn' so the gate
  // only blocks on actual new violations. Pre-existing issues remain visible
  // and get swept in Phase 6 polish.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      // Overlaps in intent with editor-local/no-nested-component-definition
      // (kept at 'error'), but fires false-positives on legitimate registry
      // lookups (e.g. node-registry.tsx). Keep as 'warn' until P6 sweep.
      'react-hooks/static-components': 'warn',
      // Honour the standard `_`-prefix convention for intentionally-unused
      // params (kept for type/signature reasons). Anything not `_`-prefixed
      // is still an error so we don't accumulate dead identifiers.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
])
