import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/*
 * A small lint config, on purpose.
 *
 * `tsc` already checks types, and the test suite checks behaviour; a lint run
 * that mostly restates those is one more thing to argue with. What neither of
 * them can see is the rules of hooks — a hook called inside a condition or a
 * loop type-checks perfectly and then corrupts React's state between renders,
 * which shows up as a component that works until the day it doesn't.
 *
 * So this enables the rules that catch real defects and leaves style alone.
 */
export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'prebuilds/**', '**/*.cjs']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Main, preload, tests and build scripts all run under Node.
    files: ['src/main/**', 'src/preload/**', 'src/shared/**', 'test/**', 'tools/**', '*.mjs', '*.ts'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    rules: {
      // The codebase uses `_`-prefixed names for deliberately unused bindings.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Electron's main process legitimately logs to the console.
      'no-console': 'off',
      // Covered by tsc, and far stricter there.
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
)
