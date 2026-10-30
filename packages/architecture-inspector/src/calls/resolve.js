import ts from "typescript";
import { isFunctionLike, unwrapExpression } from "./functions.js";
import { isClassLike } from "./symbols.js";
import { isLiteralPattern } from "./evaluate.js";

const MAX_TARGETS = 16;
const MAX_TYPE_DEPTH = 6;
// Node globals TypeScript's default libraries do not declare. Calls to them
// are provably external.
const NODE_GLOBALS = new Set(["process", "Buffer", "require", "module", "exports", "__dirname", "__filename", "global", "setImmediate", "clearImmediate"]);
// Vue's `<script setup>` compiler macros are globals of component scripts;
// emit functions and model refs they return are Vue's own values.
const VUE_MACROS = new Set(["defineProps", "defineEmits", "defineExpose", "defineOptions", "defineSlots", "defineModel", "withDefaults"]);
const VUE_EXTERNAL_VALUES = new Set(["defineEmits", "defineModel"]);
const VIA_ORDER = Object.freeze(["checker", "self", "di-binding", "argument-flow"]);

function weakerVia(left, right) {
  return VIA_ORDER.indexOf(left) >= VIA_ORDER.indexOf(right) ? left : right;
}

function isAnyType(type) {
  return Boolean(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown));
}

// JSKIT's package layout keeps client and server code apart, so a name never
// matches a candidate on the other side.
function codeSide(file) {
  const parts = file.split("/");
  if (parts.includes("server")) {
    return "server";
  }
  if (parts.includes("client") || parts[0] === "src" || file.endsWith(".vue")) {
    return "client";
  }
  return "shared";
}

function isComponentFile(file) {
  return Boolean(file) && file.endsWith(".vue");
}

function isNullish(expression) {
  const value = unwrapExpression(expression);
  return value.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(value) && value.text === "undefined");
}

function compatibleSides(left, right) {
  return left === "shared" || right === "shared" || left === right;
}

function libraryMemberNames(program) {
  const names = new Set();
  for (const sourceFile of program.getSourceFiles()) {
    if (!program.isSourceFileDefaultLibrary(sourceFile)) {
      continue;
    }
    const visit = (node) => {
      if ((ts.isMethodSignature(node) || ts.isPropertySignature(node) || ts.isMethodDeclaration(node) ||
        ts.isPropertyDeclaration(node) || ts.isGetAccessorDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        names.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return names;
}

function constructorOf(implementation) {
  if (!isClassLike(implementation)) {
    return implementation;
  }
  return implementation.members.find((member) => ts.isConstructorDeclaration(member) && member.body) || null;
}

// Call resolution over one program: TypeScript checker targets, defineFeature
// injection, argument flow, literal-array unrolling and receiver names, each
// labelled with its certainty. Provably external calls are dropped.
function createResolver({ program, checker, symbols, evaluator, bindings, actionsById, fileOf, functionNames }) {
  const builtinMembers = libraryMemberNames(program);
  const callSites = new Map();
  const direct = new Map();

  function implementationsFor(symbol) {
    return symbols.symbolImplementations(symbol).map(constructorOf).filter(Boolean);
  }

  // Pass 1: what the checker resolves on its own, and the call-site index
  // argument flow reads.
  function directResolution(call) {
    const callee = unwrapExpression(call.expression);
    if (ts.isIdentifier(callee)) {
      const symbol = symbols.symbolAt(callee);
      if (!symbol) {
        return { kind: "undeclared", name: callee.text };
      }
      if (symbols.isPackageImport(callee) || symbols.isLibrarySymbol(symbol)) {
        return { kind: "external" };
      }
      const targets = implementationsFor(symbol);
      return targets.length
        ? { kind: "targets", targets, via: "checker" }
        : { kind: "value", declaration: symbols.declarationOf(callee) };
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const symbol = checker.getSymbolAtLocation(callee.name);
      if (symbol && symbols.isLibrarySymbol(symbol)) {
        return { kind: "external" };
      }
      const targets = symbol ? implementationsFor(symbol) : [];
      return targets.length ? { kind: "targets", targets, via: "checker" } : { kind: "member", callee };
    }
    if (ts.isElementAccessExpression(callee)) {
      return { kind: "computed", callee };
    }
    if (callee.kind === ts.SyntaxKind.ImportKeyword) {
      return { kind: "external" };
    }
    const declaration = checker.getResolvedSignature(call)?.declaration;
    if (declaration && isFunctionLike(declaration) && fileOf(declaration)) {
      return { kind: "targets", targets: [declaration], via: "checker" };
    }
    if (declaration && !fileOf(declaration)) {
      return { kind: "external" };
    }
    return { kind: "other" };
  }

  // Records that a call reaches these functions, for argument flow.
  function indexSite(call, targets) {
    for (const target of targets) {
      if (!callSites.has(target)) {
        callSites.set(target, []);
      }
      callSites.get(target).push(call);
    }
  }

  // The checker's own targets of each call; returns them per call.
  function indexCalls(calls) {
    return calls.map((call) => {
      const resolution = directResolution(call);
      direct.set(call, resolution);
      indexSite(call, resolution.targets || []);
      return resolution.targets || [];
    });
  }

  // The function (and parameter position) a parameter or destructured
  // parameter element belongs to, with its property path.
  function owningParameter(declaration) {
    const pathParts = [];
    let current = declaration;
    while (current && ts.isBindingElement(current)) {
      if (!ts.isObjectBindingPattern(current.parent)) {
        return null;
      }
      const key = current.propertyName || current.name;
      if (!ts.isIdentifier(key) && !ts.isStringLiteralLike(key)) {
        return null;
      }
      pathParts.unshift(key.text);
      current = current.parent.parent;
    }
    if (!current || !ts.isParameter(current) || !isFunctionLike(current.parent)) {
      return null;
    }
    return { fn: current.parent, index: current.parent.parameters.indexOf(current), path: pathParts };
  }

  function argumentValues(declaration) {
    const owner = owningParameter(declaration);
    if (!owner) {
      return [];
    }
    const values = [];
    for (const call of callSites.get(owner.fn) || []) {
      let value = call.arguments?.[owner.index];
      if (!value || ts.isSpreadElement(value)) {
        continue;
      }
      const remaining = [...owner.path];
      while (remaining.length && ts.isObjectLiteralExpression(unwrapExpression(value))) {
        value = evaluator.propertyInitializer(unwrapExpression(value), remaining[0]);
        remaining.shift();
        if (!value) {
          break;
        }
      }
      if (value) {
        values.push({ expression: value, path: remaining });
      }
    }
    return values;
  }

  function propertyValueExpressions(property) {
    const expressions = [];
    for (const declaration of property.declarations || []) {
      if ((ts.isPropertyAssignment(declaration) || ts.isPropertyDeclaration(declaration)) && declaration.initializer) {
        expressions.push(declaration.initializer);
      } else if (ts.isShorthandPropertyAssignment(declaration)) {
        expressions.push(declaration.name);
      } else if ((ts.isPropertyAccessExpression(declaration) || ts.isBinaryExpression(declaration.parent)) &&
        ts.isBinaryExpression(declaration.parent) && declaration.parent.left === declaration) {
        expressions.push(declaration.parent.right);
      }
    }
    return expressions;
  }

  function propertyTypes(entries, name, location, depth, seen) {
    const result = [];
    for (const entry of entries) {
      for (const part of entry.type.isUnion() ? entry.type.types : [entry.type]) {
        const property = part.getProperty(name);
        if (!property) {
          continue;
        }
        const type = checker.getTypeOfSymbolAtLocation(property, location);
        if (!isAnyType(type)) {
          result.push({ ...entry, type });
          continue;
        }
        for (const expression of propertyValueExpressions(property)) {
          for (const found of typesOf(expression, depth + 1, seen)) {
            result.push({ type: found.type, exact: entry.exact && found.exact, via: weakerVia(entry.via, found.via) });
          }
        }
      }
    }
    return result;
  }

  function valueTypes(value, depth, seen) {
    let entries = typesOf(value.expression, depth + 1, seen);
    for (const name of value.path) {
      entries = propertyTypes(entries, name, value.expression, depth, seen);
    }
    return entries;
  }

  // Types an untyped expression takes through injection and argument flow.
  function typesOf(expression, depth = 0, seen = new Set()) {
    const value = unwrapExpression(expression);
    if (!value || depth > MAX_TYPE_DEPTH || seen.has(value)) {
      return [];
    }
    seen.add(value);
    const direct = checker.getTypeAtLocation(value);
    if (!isAnyType(direct)) {
      return [{ type: direct, exact: true, via: "checker" }];
    }
    if (ts.isIdentifier(value)) {
      const declaration = symbols.declarationOf(value);
      if (!declaration || !fileOf(declaration)) {
        return [];
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return typesOf(declaration.initializer, depth + 1, seen);
      }
      if (ts.isBindingElement(declaration) || ts.isParameter(declaration)) {
        const binding = bindings.get(declaration);
        if (binding) {
          return binding.expressions.flatMap((bound) => typesOf(bound, depth + 1, seen).map((entry) => ({
            type: entry.type,
            exact: entry.exact && binding.exact,
            via: weakerVia(entry.via, "di-binding")
          })));
        }
        return argumentValues(declaration).flatMap((bound) => valueTypes(bound, depth, seen).map((entry) => ({
          type: entry.type,
          exact: false,
          via: "argument-flow"
        })));
      }
      return [];
    }
    if (ts.isPropertyAccessExpression(value)) {
      return propertyTypes(typesOf(value.expression, depth + 1, seen), value.name.text, value, depth, seen);
    }
    if (ts.isCallExpression(value)) {
      const signatures = typesOf(value.expression, depth + 1, seen).flatMap((entry) =>
        entry.type.getCallSignatures().map((signature) => ({ ...entry, type: signature.getReturnType() })));
      return signatures.filter((entry) => !isAnyType(entry.type));
    }
    if (ts.isAwaitExpression(value)) {
      return typesOf(value.expression, depth + 1, seen).map((entry) => ({ ...entry, type: checker.getAwaitedType(entry.type) || entry.type }));
    }
    return [];
  }

  function targetsFromTypes(entries, names) {
    const targets = new Map();
    let external = false;
    for (const entry of entries) {
      for (const part of entry.type.isUnion() ? entry.type.types : [entry.type]) {
        for (const name of names) {
          const property = part.getProperty(name);
          if (!property) {
            continue;
          }
          if (symbols.isLibrarySymbol(property)) {
            external = true;
            continue;
          }
          for (const target of implementationsFor(property)) {
            const previous = targets.get(target);
            targets.set(target, previous
              ? { exact: previous.exact && entry.exact, via: weakerVia(previous.via, entry.via) }
              : { exact: entry.exact, via: entry.via });
          }
        }
      }
    }
    return { targets, external };
  }

  function fromTargets(targets, { exactAllowed = true, method }) {
    const list = [...targets.keys()];
    if (!list.length) {
      return null;
    }
    if (list.length > MAX_TARGETS) {
      return unresolved();
    }
    const facts = [...targets.values()];
    const via = method || facts.map((entry) => entry.via).reduce(weakerVia);
    if (list.length === 1) {
      const exact = exactAllowed && facts[0].exact && via !== "argument-flow";
      return { resolution: "resolved", certainty: exact ? "exact" : "probable", method: via, targets: list };
    }
    return { resolution: "ambiguous", certainty: "probable", method: via, targets: list };
  }

  function unresolved() {
    return { resolution: "unresolved", certainty: "unresolved", method: "none", targets: [] };
  }

  // Values of an injected or passed-in function, called directly.
  function boundFunctionTargets(declaration) {
    const targets = new Map();
    const binding = bindings.get(declaration);
    if (binding) {
      for (const expression of binding.expressions) {
        for (const target of symbols.expressionImplementations(expression, 0).map(constructorOf).filter(Boolean)) {
          targets.set(target, { exact: binding.exact, via: "di-binding" });
        }
      }
      return targets;
    }
    for (const value of argumentValues(declaration)) {
      if (value.path.length) {
        const found = targetsFromTypes(valueTypes({ expression: value.expression, path: value.path.slice(0, -1) }, 0, new Set()), [value.path.at(-1)]);
        for (const target of found.targets.keys()) {
          targets.set(target, { exact: false, via: "argument-flow" });
        }
        continue;
      }
      for (const target of symbols.expressionImplementations(value.expression, 0).map(constructorOf).filter(Boolean)) {
        targets.set(target, { exact: false, via: "argument-flow" });
      }
    }
    return targets;
  }

  // Whether a value is provably produced by a package or builtin.
  function isExternalValue(expression, depth = 0) {
    const root = symbols.receiverRoot(expression);
    if (!root || depth > MAX_TYPE_DEPTH) {
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
    if (!current || depth > MAX_TYPE_DEPTH) {
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

  function receiverHint(receiver, candidates) {
    const text = receiver?.getText().split(".").pop()?.replace(/Service$/u, "").toLowerCase();
    if (!text || !/^[a-z][\w]*$/u.test(text)) {
      return [];
    }
    const singular = text.replace(/s$/u, "");
    return candidates.filter((candidate) => fileOf(candidate).toLowerCase().split(/[/.-]/u)
      .some((token) => token === text || token === singular));
  }

  function byName(name, receiver, file) {
    const side = codeSide(file);
    const candidates = (functionNames.get(name) || []).filter((candidate) => compatibleSides(side, codeSide(fileOf(candidate))));
    if (!candidates.length) {
      return builtinMembers.has(name) ? null : unresolved();
    }
    const hinted = candidates.length > 1 ? receiverHint(receiver, candidates) : [];
    const chosen = hinted.length === 1 ? hinted : candidates;
    if (chosen.length > MAX_TARGETS) {
      return unresolved();
    }
    return {
      resolution: chosen.length === 1 ? "resolved" : "ambiguous",
      certainty: "probable",
      method: "receiver-name",
      targets: chosen
    };
  }

  function enclosingClass(node) {
    let current = node.parent;
    while (current && !isClassLike(current)) {
      current = current.parent;
    }
    return current;
  }

  function selfMethod(callee) {
    if (callee.expression.kind !== ts.SyntaxKind.ThisKeyword) {
      return null;
    }
    const owner = enclosingClass(callee);
    const method = owner?.members.find((member) => ts.isMethodDeclaration(member) && member.body &&
      member.name && ts.isIdentifier(member.name) && member.name.text === callee.name.text);
    return method ? { resolution: "resolved", certainty: "exact", method: "self", targets: [method] } : null;
  }

  // `request.executeAction({ actionId: "literal" })` runs that action.
  function actionCall(call, callee) {
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "executeAction") {
      return null;
    }
    const options = unwrapExpression(call.arguments[0]);
    const idExpression = options && ts.isObjectLiteralExpression(options) ? evaluator.propertyInitializer(options, "actionId") : null;
    const actionId = idExpression && evaluator.evaluateLiteral(idExpression);
    const definitions = actionId ? actionsById.get(actionId) || [] : [];
    const executes = definitions.flatMap((definition) => definition.execute);
    if (definitions.length !== 1 || executes.length !== 1) {
      return null;
    }
    return { resolution: "resolved", certainty: "exact", method: "route-action", targets: executes };
  }

  function memberResolution(call, callee, file) {
    const action = actionCall(call, callee);
    if (action) {
      return action;
    }
    if (isExternalValue(callee.expression)) {
      return null;
    }
    const found = targetsFromTypes(typesOf(callee.expression), [callee.name.text]);
    if (found.targets.size) {
      return fromTargets(found.targets, {});
    }
    if (found.external) {
      return null;
    }
    return selfMethod(callee) || byName(callee.name.text, callee.expression, file);
  }

  function computedResolution(callee) {
    if (isExternalValue(callee.expression)) {
      return null;
    }
    const names = evaluator.evaluate(callee.argumentExpression);
    if (!names.every(isLiteralPattern)) {
      return unresolved();
    }
    const found = targetsFromTypes(typesOf(callee.expression), names);
    if (found.targets.size) {
      return fromTargets(found.targets, {});
    }
    return found.external ? null : unresolved();
  }

  // Pass 2: the final certainty of one call, or null when it is external.
  function resolve(call, file) {
    const resolution = direct.get(call) || directResolution(call);
    const callee = unwrapExpression(call.expression);
    switch (resolution.kind) {
      case "targets":
        return fromTargets(new Map(resolution.targets.map((target) => [target, { exact: true, via: "checker" }])), {});
      case "external":
        return null;
      case "undeclared":
        return NODE_GLOBALS.has(resolution.name) || (isComponentFile(file) && VUE_MACROS.has(resolution.name)) ? null : unresolved();
      case "value": {
        const declaration = resolution.declaration;
        const bound = declaration && (ts.isParameter(declaration) || ts.isBindingElement(declaration))
          ? fromTargets(boundFunctionTargets(declaration), {})
          : null;
        if (bound) {
          return bound;
        }
        return declaration && isExternalDeclaration(declaration, 0) ? null : unresolved();
      }
      case "member":
        return memberResolution(call, resolution.callee, file);
      case "computed":
        return computedResolution(callee);
      default:
        return unresolved();
    }
  }

  return { indexCalls, indexSite, resolve, builtinMembers };
}

export { codeSide, createResolver };
