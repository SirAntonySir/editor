import { RuleTester } from 'eslint';
import rule from './no-nested-component-definition.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-nested-component-definition', rule, {
  valid: [
    {
      code: 'function Outer() { return <div/>; }',
    },
    {
      code: 'function Outer() { const handler = () => 1; return <div/>; }',
    },
    {
      code: 'function Outer({ render }) { return render(<span/>); }',
    },
  ],
  invalid: [
    {
      code: 'function Outer() { function Inner() { return <span/>; } return <Inner/>; }',
      errors: [{ messageId: 'nestedComponent' }],
    },
    {
      code: 'function Outer() { const Inner = () => <span/>; return <Inner/>; }',
      errors: [{ messageId: 'nestedComponent' }],
    },
  ],
});

console.log('no-nested-component-definition: all tests passed');
