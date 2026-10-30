import ts from "typescript";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { isFunctionLike, unwrapExpression } from "./functions.js";

// Partial string evaluation for operation paths and identities. Unknown parts
// become SEGMENT (one path segment) or ANY (any length); results are bounded.
const SEGMENT = "\u0002";
const ANY = "\u0003";
const MAX_PATTERNS = 12;
const MAX_DEPTH = 8;
const MAX_UNROLLED_ELEMENTS = 64;
const VUE_VALUE_WRAPPERS = Object.freeze(["computed", "ref", "shallowRef", "unref", "toValue", "readonly"]);

function concat(left, right) {
  const result = [];
  for (const first of left) {
    for (const second of right) {
      result.push(first + second);
      if (result.length >= MAX_PATTERNS) {
        return result;
      }
    }
  }
  return result;
}

function union(...lists) {
  return [...new Set(lists.flat())].slice(0, MAX_PATTERNS);
}

function isLiteralPattern(value) {
  return typeof value === "string" && !value.includes(SEGMENT) && !value.includes(ANY);
}

function emptyEnvironment() {
  return { indexes: new Map(), values: new Map() };
}

function normalizedSegment(value) {
  return value.startsWith("/") || value.startsWith(ANY) || value === "" ? value : `/${value}`;
}

function createEvaluator({ symbols, fileOf }) {
  const unrolled = new Map();

  function functionReturns(fn) {
    if (!fn.body) {
      return [];
    }
    if (!ts.isBlock(fn.body)) {
      return [fn.body];
    }
    const results = [];
    const visit = (node) => {
      if (node !== fn && isFunctionLike(node)) {
        return;
      }
      if (ts.isReturnStatement(node) && node.expression) {
        results.push(node.expression);
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
    return results;
  }

  function propertyInitializer(objectLiteral, name) {
    const entry = objectLiteral.properties.find((property) =>
      property.name && !ts.isComputedPropertyName(property.name) && property.name.text === name);
    if (!entry) {
      return undefined;
    }
    if (ts.isPropertyAssignment(entry)) {
      return entry.initializer;
    }
    if (ts.isShorthandPropertyAssignment(entry)) {
      return entry.name;
    }
    return entry;
  }

  // `Object.freeze(x)` and parentheses are transparent for constant data.
  function constantExpression(node) {
    const value = unwrapExpression(node);
    if (value && ts.isCallExpression(value) && value.arguments.length === 1 &&
      ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === "freeze" &&
      ts.isIdentifier(value.expression.expression) && value.expression.expression.text === "Object") {
      return unwrapExpression(value.arguments[0]);
    }
    return value;
  }

  // The constant a const-bound identifier holds, or undefined.
  function constantInitializer(identifier) {
    const declaration = symbols.declarationOf(identifier);
    if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer || !fileOf(declaration)) {
      return undefined;
    }
    const list = declaration.parent;
    if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) {
      return undefined;
    }
    return declaration.initializer;
  }

  // Literal JSON-like data, following const bindings: { value } or undefined.
  function literalValue(node, depth = 0) {
    const value = constantExpression(node);
    if (!value || depth > MAX_DEPTH) {
      return undefined;
    }
    if (ts.isStringLiteralLike(value)) {
      return { value: value.text };
    }
    if (ts.isNumericLiteral(value)) {
      return { value: Number(value.text) };
    }
    if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
      return { value: value.kind === ts.SyntaxKind.TrueKeyword };
    }
    if (value.kind === ts.SyntaxKind.NullKeyword) {
      return { value: null };
    }
    if (ts.isTemplateExpression(value)) {
      const text = evaluate(value);
      return text.length === 1 && isLiteralPattern(text[0]) ? { value: text[0] } : undefined;
    }
    if (ts.isArrayLiteralExpression(value)) {
      const items = [];
      for (const element of value.elements) {
        const item = ts.isSpreadElement(element) ? undefined : literalValue(element, depth + 1);
        if (!item) {
          return undefined;
        }
        items.push(item.value);
      }
      return { value: items };
    }
    if (ts.isObjectLiteralExpression(value)) {
      const result = {};
      for (const property of value.properties) {
        if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) {
          return undefined;
        }
        const item = literalValue(property.initializer, depth + 1);
        if (!item) {
          return undefined;
        }
        result[property.name.text] = item.value;
      }
      return { value: result };
    }
    if (ts.isIdentifier(value)) {
      const initializer = constantInitializer(value);
      return initializer ? literalValue(initializer, depth + 1) : undefined;
    }
    if (ts.isPropertyAccessExpression(value)) {
      const base = literalValue(value.expression, depth + 1);
      const item = base?.value && typeof base.value === "object" && !Array.isArray(base.value) ? base.value[value.name.text] : undefined;
      return item === undefined ? undefined : { value: item };
    }
    return undefined;
  }

  // A literal array of at most 64 literal elements, or null.
  function literalArray(node) {
    const result = literalValue(node);
    return Array.isArray(result?.value) && result.value.length <= MAX_UNROLLED_ELEMENTS ? result.value : null;
  }

  function bindingPath(declaration) {
    const pathParts = [];
    let current = declaration;
    while (current && ts.isBindingElement(current)) {
      const pattern = current.parent;
      if (ts.isObjectBindingPattern(pattern)) {
        const key = current.propertyName || current.name;
        if (!ts.isIdentifier(key) && !ts.isStringLiteralLike(key)) {
          return null;
        }
        pathParts.unshift(key.text);
      } else {
        pathParts.unshift(pattern.elements.indexOf(current));
      }
      current = pattern.parent;
    }
    return current ? { root: current, path: pathParts } : null;
  }

  // An identifier bound per element of a literal array by `.map(callback)` or
  // `for (... of array)`: { scope, values } with one value per element.
  function unrolledBinding(declaration) {
    if (!declaration) {
      return null;
    }
    if (unrolled.has(declaration)) {
      return unrolled.get(declaration);
    }
    unrolled.set(declaration, null);
    const located = bindingPath(declaration);
    let scope = null;
    let elements = null;
    if (located && ts.isParameter(located.root)) {
      const callback = located.root.parent;
      const call = callback?.parent;
      if (isFunctionLike(callback) && callback.parameters[0] === located.root && call && ts.isCallExpression(call) &&
        call.arguments[0] === callback && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "map") {
        scope = callback;
        elements = literalArray(call.expression.expression);
      }
    } else if (located && ts.isVariableDeclaration(located.root)) {
      const statement = located.root.parent?.parent;
      if (statement && ts.isForOfStatement(statement) && statement.initializer === located.root.parent) {
        scope = statement;
        elements = literalArray(statement.expression);
      }
    }
    if (!scope || !elements) {
      return null;
    }
    const values = elements.map((element) => located.path.reduce((value, key) => (value == null ? undefined : value[key]), element));
    const binding = { scope, values };
    unrolled.set(declaration, binding);
    return binding;
  }

  function scalarPatterns(value) {
    return typeof value === "string" || typeof value === "number" ? [String(value)] : [ANY];
  }

  function evaluateIdentifier(node, environment, depth) {
    const declaration = symbols.declarationOf(node);
    if (!declaration) {
      return [ANY];
    }
    if (environment.values.has(declaration)) {
      return environment.values.get(declaration);
    }
    const binding = unrolledBinding(declaration);
    if (binding) {
      if (environment.indexes.has(binding.scope)) {
        return scalarPatterns(binding.values[environment.indexes.get(binding.scope)]);
      }
      return union(...binding.values.map(scalarPatterns));
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer && fileOf(declaration)) {
      return evaluate(declaration.initializer, environment, depth + 1);
    }
    // A parameter default is the value when callers omit it.
    if ((ts.isParameter(declaration) || ts.isBindingElement(declaration)) && declaration.initializer && fileOf(declaration)) {
      return evaluate(declaration.initializer, environment, depth + 1);
    }
    return [ANY];
  }

  function evaluatePropertyAccess(node, environment, depth) {
    if (node.name.text === "value") {
      return evaluate(node.expression, environment, depth + 1);
    }
    const base = unwrapExpression(node.expression);
    if (ts.isIdentifier(base)) {
      const initializer = constantInitializer(base);
      const object = initializer && constantExpression(initializer);
      if (object && ts.isObjectLiteralExpression(object)) {
        const value = propertyInitializer(object, node.name.text);
        if (value && !isFunctionLike(value)) {
          return evaluate(value, environment, depth + 1);
        }
      }
    }
    return [ANY];
  }

  function calleeName(callee) {
    if (ts.isIdentifier(callee)) {
      return callee.text;
    }
    return ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
  }

  // Whether an expression is the result of JSKIT's `usePaths()`.
  function isPathsReceiver(expression) {
    let value = unwrapExpression(expression);
    if (value && ts.isIdentifier(value)) {
      const declaration = symbols.declarationOf(value);
      value = declaration && ts.isVariableDeclaration(declaration) ? unwrapExpression(declaration.initializer) : null;
    }
    return Boolean(value) && ts.isCallExpression(value) && ts.isIdentifier(value.expression) &&
      symbols.isImportOf(value.expression, "@jskit-ai/shell-web", ["usePaths"]);
  }

  function isPathsApi(callee) {
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "api") {
      return isPathsReceiver(callee.expression);
    }
    if (ts.isIdentifier(callee)) {
      const declaration = symbols.declarationOf(callee);
      const key = declaration && ts.isBindingElement(declaration) ? (declaration.propertyName || declaration.name) : null;
      const owner = declaration?.parent?.parent;
      return Boolean(key) && ts.isIdentifier(key) && key.text === "api" && owner && ts.isVariableDeclaration(owner) &&
        isPathsReceiver(owner.initializer);
    }
    return false;
  }

  function objectArgumentPatterns(argument, name, environment, depth, fallback) {
    const object = unwrapExpression(argument);
    if (!object || !ts.isObjectLiteralExpression(object)) {
      return argument ? [ANY] : [fallback];
    }
    const value = propertyInitializer(object, name);
    return value ? evaluate(value, environment, depth + 1) : [fallback];
  }

  // Inlines a local project helper whose returns can be evaluated.
  function inlineHelper(callee, args, environment, depth) {
    const declaration = symbols.declarationOf(callee);
    let fn = declaration;
    if (fn && ts.isVariableDeclaration(fn)) {
      fn = unwrapExpression(fn.initializer);
    }
    if (!fn || !isFunctionLike(fn) || !fileOf(fn)) {
      return null;
    }
    const values = new Map(environment.values);
    fn.parameters.forEach((parameter, index) => {
      const argument = args[index];
      if (ts.isIdentifier(parameter.name)) {
        const value = argument ? evaluate(argument, environment, depth + 1)
          : parameter.initializer ? evaluate(parameter.initializer, environment, depth + 1) : [""];
        values.set(parameter, value);
      } else if (ts.isObjectBindingPattern(parameter.name)) {
        for (const element of parameter.name.elements) {
          const key = element.propertyName || element.name;
          if (ts.isIdentifier(key) && ts.isIdentifier(element.name)) {
            const fallback = element.initializer ? evaluate(element.initializer, environment, depth + 1) : [""];
            const object = unwrapExpression(argument);
            const property = object && ts.isObjectLiteralExpression(object) ? propertyInitializer(object, key.text) : undefined;
            values.set(element, property ? evaluate(property, environment, depth + 1) : argument && !object?.properties ? [ANY] : fallback);
          }
        }
      }
    });
    const returns = functionReturns(fn);
    if (!returns.length) {
      return null;
    }
    const inner = { indexes: environment.indexes, values };
    return union(...returns.map((expression) => evaluate(expression, inner, depth + 1)));
  }

  function evaluateCall(node, environment, depth) {
    const callee = unwrapExpression(node.expression);
    const name = calleeName(callee);
    const args = node.arguments;
    if (ts.isIdentifier(callee) && VUE_VALUE_WRAPPERS.includes(name) && symbols.isImportOf(callee, "vue", VUE_VALUE_WRAPPERS)) {
      const value = unwrapExpression(args[0]);
      if (value && isFunctionLike(value)) {
        return union(...functionReturns(value).map((expression) => evaluate(expression, environment, depth + 1)));
      }
      return value ? evaluate(value, environment, depth + 1) : [ANY];
    }
    const stringDeclaration = name === "String" && ts.isIdentifier(callee) ? symbols.declarationOf(callee) : null;
    if (ts.isIdentifier(callee) && name === "String" && !(stringDeclaration && fileOf(stringDeclaration))) {
      return args[0] ? evaluate(args[0], environment, depth + 1) : [""];
    }
    if (ts.isPropertyAccessExpression(callee) && ["trim", "toString"].includes(name)) {
      return evaluate(callee.expression, environment, depth + 1);
    }
    if (ts.isPropertyAccessExpression(callee) && name === "toLowerCase") {
      return evaluate(callee.expression, environment, depth + 1).map((value) => value.toLowerCase());
    }
    if (/^encode/iu.test(name)) {
      const value = args[0] ? evaluate(args[0], environment, depth + 1) : [SEGMENT];
      return value.map((entry) => (isLiteralPattern(entry) ? entry : SEGMENT));
    }
    if (["replace", "replaceAll"].includes(name) && ts.isPropertyAccessExpression(callee) &&
      args[0] && ts.isRegularExpressionLiteral(args[0]) && args[1] && ts.isStringLiteralLike(args[1])) {
      const text = args[0].text;
      const expression = new RegExp(text.slice(1, text.lastIndexOf("/")), text.slice(text.lastIndexOf("/") + 1));
      return evaluate(callee.expression, environment, depth + 1).map((entry) => entry.replace(expression, args[1].text));
    }
    if (isPathsApi(callee)) {
      // usePaths().api(suffix): the API base path and suffix under the
      // surface's root route base.
      const suffix = args[0] ? evaluate(args[0], environment, depth + 1) : [ANY];
      return suffix.map((relativePath) => resolveScopedApiBasePath({ relativePath: normalizedSegment(relativePath), strictParams: false }));
    }
    if (ts.isIdentifier(callee) && symbols.isImportOf(callee, "@jskit-ai/kernel", ["resolveScopedApiBasePath"])) {
      const routeBases = objectArgumentPatterns(args[0], "routeBase", environment, depth, "/");
      const relativePaths = objectArgumentPatterns(args[0], "relativePath", environment, depth, "/");
      const result = [];
      for (const routeBase of routeBases) {
        for (const relativePath of relativePaths) {
          result.push(resolveScopedApiBasePath({ routeBase, relativePath, strictParams: false }));
        }
      }
      return union(result);
    }
    if (ts.isIdentifier(callee)) {
      return inlineHelper(callee, args, environment, depth) || [ANY];
    }
    return [ANY];
  }

  function evaluate(node, environment = emptyEnvironment(), depth = 0) {
    const value = unwrapExpression(node);
    if (!value || depth > MAX_DEPTH) {
      return [ANY];
    }
    if (ts.isStringLiteralLike(value)) {
      return [value.text];
    }
    if (ts.isNumericLiteral(value)) {
      return [String(Number(value.text))];
    }
    if (ts.isTemplateExpression(value)) {
      let result = [value.head.text];
      for (const span of value.templateSpans) {
        result = concat(concat(result, evaluate(span.expression, environment, depth + 1)), [span.literal.text]);
      }
      return result;
    }
    if (ts.isBinaryExpression(value)) {
      const operator = value.operatorToken.kind;
      if (operator === ts.SyntaxKind.PlusToken) {
        return concat(evaluate(value.left, environment, depth + 1), evaluate(value.right, environment, depth + 1));
      }
      if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
        return union(evaluate(value.left, environment, depth + 1), evaluate(value.right, environment, depth + 1));
      }
      return [ANY];
    }
    if (ts.isConditionalExpression(value)) {
      return union(evaluate(value.whenTrue, environment, depth + 1), evaluate(value.whenFalse, environment, depth + 1));
    }
    if (ts.isAwaitExpression(value)) {
      return evaluate(value.expression, environment, depth + 1);
    }
    if (ts.isIdentifier(value)) {
      return evaluateIdentifier(value, environment, depth);
    }
    if (ts.isPropertyAccessExpression(value)) {
      return evaluatePropertyAccess(value, environment, depth);
    }
    if (ts.isCallExpression(value)) {
      return evaluateCall(value, environment, depth);
    }
    return [ANY];
  }

  // One literal string, or null when any part is dynamic or alternatives exist.
  function evaluateLiteral(node, environment) {
    const values = evaluate(node, environment);
    return values.length === 1 && isLiteralPattern(values[0]) ? values[0] : null;
  }

  return {
    evaluate,
    evaluateLiteral,
    literalValue,
    literalArray,
    unrolledBinding,
    functionReturns,
    propertyInitializer
  };
}

export { ANY, SEGMENT, createEvaluator, isLiteralPattern };
