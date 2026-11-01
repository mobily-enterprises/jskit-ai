import ts from "typescript";
import { isFunctionLike, unwrapExpression } from "./functions.js";

const MAX_DEPTH = 6;
// Node globals TypeScript's default libraries do not declare. Calls to them
// are provably external.
const NODE_GLOBALS = new Set(["process", "Buffer", "require", "module", "exports", "__dirname", "__filename", "global", "setImmediate", "clearImmediate"]);
// Emit functions and model refs Vue's `<script setup>` macros return are
// Vue's own values.
const VUE_EXTERNAL_VALUES = new Set(["defineEmits", "defineModel"]);

function isComponentFile(file) {
  return Boolean(file) && file.endsWith(".vue");
}

function isNullish(expression) {
  const value = unwrapExpression(expression);
  return value.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(value) && value.text === "undefined");
}

/**
 * Whether values are provably produced by a package or builtin, so calls on
 * them leave the project.
 * @param {object} dependencies
 * @param {import("typescript").TypeChecker} dependencies.checker
 * @param {import("./types.js").CallSymbols} dependencies.symbols
 * @param {import("./types.js").FileOf} dependencies.fileOf
 */
function createExternalValues({ checker, symbols, fileOf }) {
  // Whether a value is provably produced by a package or builtin.
  function isExternalValue(expression, depth = 0) {
    const root = symbols.receiverRoot(expression);
    if (!root || depth > MAX_DEPTH) {
      return false;
    }
    if (ts.isIdentifier(root)) {
      if (symbols.isPackageImport(root)) {
        return true;
      }
      const symbol = symbols.symbolAt(root);
      if (!symbol) {
        return NODE_GLOBALS.has(root.text) || (isComponentFile(fileOf(root)) && VUE_EXTERNAL_VALUES.has(root.text));
      }
      if (symbols.isLibrarySymbol(symbol)) {
        return true;
      }
      const declaration = symbols.declarationOf(root);
      return Boolean(declaration) && isExternalDeclaration(declaration, depth + 1);
    }
    return ts.isStringLiteralLike(root) || ts.isArrayLiteralExpression(root) || ts.isRegularExpressionLiteral(root) ||
      ts.isTemplateExpression(root) || ts.isNumericLiteral(root);
  }

  // Whether every value a declared name can hold comes from a package or
  // builtin: its initializer and later assignments, the iterable it is taken
  // from, the value it is destructured from, or the external call a callback
  // parameter is supplied by.
  function isExternalDeclaration(declaration, depth) {
    let current = declaration;
    while (current && ts.isBindingElement(current)) {
      current = current.parent.parent;
    }
    if (!current || depth > MAX_DEPTH) {
      return false;
    }
    if (ts.isParameter(current)) {
      const fn = current.parent;
      const call = fn.parent;
      return (ts.isCallExpression(call) || ts.isNewExpression(call)) && Boolean(call.arguments?.includes(fn)) &&
        isExternalCallee(call.expression, depth + 1);
    }
    if (!ts.isVariableDeclaration(current)) {
      return false;
    }
    const statement = current.parent?.parent;
    if (statement && ts.isForOfStatement(statement) && statement.initializer === current.parent) {
      return isExternalValue(statement.expression, depth + 1);
    }
    const values = [current.initializer, ...assignedValues(current)].filter((value) => value && !isNullish(value));
    return values.length > 0 && values.every((value) => isExternalValue(value, depth + 1));
  }

  function isExternalCallee(expression, depth) {
    const callee = unwrapExpression(expression);
    if (ts.isIdentifier(callee)) {
      const symbol = symbols.symbolAt(callee);
      return symbol ? symbols.isPackageImport(callee) || symbols.isLibrarySymbol(symbol) : NODE_GLOBALS.has(callee.text);
    }
    return ts.isPropertyAccessExpression(callee) && isExternalValue(callee.expression, depth);
  }

  // The values later assigned to a `let` or `var` name within its scope.
  const assignments = new Map();
  function assignedValues(declaration) {
    if (!ts.isIdentifier(declaration.name) || declaration.parent.flags & ts.NodeFlags.Const) {
      return [];
    }
    if (!assignments.has(declaration)) {
      const symbol = checker.getSymbolAtLocation(declaration.name);
      let scope = declaration.parent;
      while (scope && !isFunctionLike(scope) && !ts.isSourceFile(scope)) {
        scope = scope.parent;
      }
      const values = [];
      const visit = (node) => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left) && node.left.text === declaration.name.text && checker.getSymbolAtLocation(node.left) === symbol) {
          values.push(node.right);
        }
        ts.forEachChild(node, visit);
      };
      if (scope) {
        visit(scope);
      }
      assignments.set(declaration, values);
    }
    return assignments.get(declaration);
  }

  return Object.freeze({ isExternalValue, isExternalDeclaration });
}

export { NODE_GLOBALS, createExternalValues, isComponentFile };
