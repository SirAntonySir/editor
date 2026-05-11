/**
 * Flags function declarations / arrow-function expressions that:
 *   (a) are declared inside another function's body, and
 *   (b) appear to return JSX (i.e. are visually a React component).
 *
 * Render callbacks (e.g. passed inline to .map or as props) are intentionally
 * out of scope — they're flagged by their NAME convention only. A callback
 * starting with a lowercase letter and not directly assigned to an
 * UpperCamelCase identifier is treated as non-component.
 */

function isUpperCamelCase(name) {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function returnsJSX(node) {
  // Body may be a BlockStatement (contains ReturnStatement) or an Expression
  // (arrow function with implicit return).
  if (!node.body) return false;
  if (node.body.type === 'JSXElement' || node.body.type === 'JSXFragment') return true;
  if (node.body.type !== 'BlockStatement') return false;
  for (const stmt of node.body.body) {
    if (stmt.type !== 'ReturnStatement' || !stmt.argument) continue;
    const t = stmt.argument.type;
    if (t === 'JSXElement' || t === 'JSXFragment') return true;
    if (t === 'ConditionalExpression') {
      const c = stmt.argument.consequent.type;
      const a = stmt.argument.alternate.type;
      if (c === 'JSXElement' || c === 'JSXFragment' || a === 'JSXElement' || a === 'JSXFragment') return true;
    }
  }
  return false;
}

function getDeclaredName(node) {
  if (node.type === 'FunctionDeclaration' && node.id) return node.id.name;
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    if (node.parent && node.parent.type === 'VariableDeclarator' && node.parent.id.type === 'Identifier') {
      return node.parent.id.name;
    }
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow defining a React component inside another function body. Hoist to module scope or a sibling file.',
    },
    messages: {
      nestedComponent:
        'Component "{{name}}" is declared inside another function. Hoist it to module scope or a sibling file (see CLAUDE.md → Component Architecture).',
    },
    schema: [],
  },
  create(context) {
    const fnStack = [];

    function enter(node) {
      const name = getDeclaredName(node);
      if (fnStack.length > 0 && name && isUpperCamelCase(name) && returnsJSX(node)) {
        context.report({ node, messageId: 'nestedComponent', data: { name } });
      }
      fnStack.push(node);
    }

    function leave() {
      fnStack.pop();
    }

    return {
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': leave,
      FunctionExpression: enter,
      'FunctionExpression:exit': leave,
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': leave,
    };
  },
};
