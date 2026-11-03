import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Not enabled on purpose: Nest DI reads constructor types from decorator
      // metadata, so forcing `import type` would silently break injection.
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
);
