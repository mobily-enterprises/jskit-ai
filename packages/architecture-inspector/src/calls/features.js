import ts from "typescript";
import { isFunctionLike, unwrapExpression } from "./functions.js";

const FEATURE_PACKAGE = "@jskit-ai/kernel";
const MAX_ACTION_DEPTH = 6;

function memberNamed(objectLiteral, name) {
  return objectLiteral.properties.find((property) =>
    property.name && !ts.isComputedPropertyName(property.name) && property.name.text === name);
}

function isActionObject(node) {
  return Boolean(node) && ts.isObjectLiteralExpression(node) &&
    Boolean(memberNamed(node, "id")) && Boolean(memberNamed(node, "execute"));
}

// JSKIT's defineFeature dependency injection, read statically:
// requires/optional tokens, provides tokens, setup outputs and the actions()
// definitions. Feature setup and actions parameters are bound to the
// expressions their providers return. One provider is exact; several are
// ambiguous; none leaves the parameter unbound.
function bindFeatures({ calls, symbols, evaluator }) {
  const features = [];
  for (const call of calls) {
    const callee = unwrapExpression(call.expression);
    if (!ts.isIdentifier(callee) || !symbols.isImportOf(callee, FEATURE_PACKAGE, ["defineFeature"])) {
      continue;
    }
    const definition = unwrapExpression(call.arguments[0]);
    if (definition && ts.isObjectLiteralExpression(definition)) {
      features.push(readFeature(definition));
    }
  }

  function memberFunctions(member) {
    if (!member) {
      return [];
    }
    if (isFunctionLike(member)) {
      return [member];
    }
    if (ts.isPropertyAssignment(member)) {
      return symbols.expressionImplementations(member.initializer, 0).filter(isFunctionLike);
    }
    if (ts.isShorthandPropertyAssignment(member)) {
      return symbols.symbolImplementations(symbols.symbolAt(member.name)).filter(isFunctionLike);
    }
    return [];
  }

  function tokens(member) {
    const result = new Map();
    const value = member && ts.isPropertyAssignment(member) ? unwrapExpression(member.initializer) : null;
    if (!value || !ts.isObjectLiteralExpression(value)) {
      return result;
    }
    for (const property of value.properties) {
      const initializer = ts.isPropertyAssignment(property) ? property.initializer
        : ts.isShorthandPropertyAssignment(property) ? property.name : null;
      const token = initializer && evaluator.evaluateLiteral(initializer);
      if (token && property.name && !ts.isComputedPropertyName(property.name)) {
        result.set(property.name.text, token);
      }
    }
    return result;
  }

  function returnedObject(expression) {
    let value = unwrapExpression(expression);
    if (value && ts.isIdentifier(value)) {
      const declaration = symbols.declarationOf(value);
      value = declaration && ts.isVariableDeclaration(declaration) ? unwrapExpression(declaration.initializer) : null;
    }
    return value && ts.isObjectLiteralExpression(value) ? value : null;
  }

  function setupOutputs(setups) {
    const outputs = new Map();
    for (const setup of setups) {
      for (const expression of evaluator.functionReturns(setup)) {
        const object = returnedObject(expression);
        for (const property of object?.properties || []) {
          if (ts.isShorthandPropertyAssignment(property)) {
            outputs.set(property.name.text, [...(outputs.get(property.name.text) || []), property.name]);
          } else if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
            outputs.set(property.name.text, [...(outputs.get(property.name.text) || []), property.initializer]);
          }
        }
      }
    }
    return outputs;
  }

  function readFeature(definition) {
    const setups = memberFunctions(memberNamed(definition, "setup"));
    const actionsMember = memberNamed(definition, "actions");
    return {
      definition,
      requires: new Map([...tokens(memberNamed(definition, "optional")), ...tokens(memberNamed(definition, "requires"))]),
      provides: tokens(memberNamed(definition, "provides")),
      setups,
      actionFunctions: memberFunctions(actionsMember),
      actionsMember,
      outputs: setupOutputs(setups)
    };
  }

  const providers = new Map();
  for (const feature of features) {
    for (const [name, token] of feature.provides) {
      for (const expression of feature.outputs.get(name) || []) {
        providers.set(token, [...(providers.get(token) || []), expression]);
      }
    }
  }

  const bindings = new Map();
  function bindPattern(fn, valuesFor) {
    const parameter = fn.parameters[0];
    if (!parameter || !ts.isObjectBindingPattern(parameter.name)) {
      return;
    }
    for (const element of parameter.name.elements) {
      const key = element.propertyName || element.name;
      if (!ts.isIdentifier(key) || !ts.isIdentifier(element.name)) {
        continue;
      }
      const expressions = valuesFor(key.text);
      if (expressions.length) {
        bindings.set(element, { expressions, exact: expressions.length === 1 });
      }
    }
  }
  for (const feature of features) {
    const provided = (name) => providers.get(feature.requires.get(name)) || [];
    for (const setup of feature.setups) {
      bindPattern(setup, provided);
    }
    for (const actions of feature.actionFunctions) {
      bindPattern(actions, (name) => feature.outputs.get(name) || provided(name));
    }
  }

  return { features, bindings, actions: collectFeatureActions(features, { symbols, evaluator }) };
}

// Action definitions inside each feature's actions() result: object literals
// with `id` and `execute`, possibly wrapped by a pass-through call, through
// arrays, spreads, project factory functions and literal-array `.map`.
function collectFeatureActions(features, { symbols, evaluator }) {
  const found = [];
  const seenFunctions = new Set();

  function collect(node, indexes, depth) {
    const value = unwrapExpression(node);
    if (!value || depth > MAX_ACTION_DEPTH) {
      return;
    }
    if (ts.isObjectLiteralExpression(value)) {
      if (isActionObject(value)) {
        found.push({ object: value, indexes });
        return;
      }
      for (const property of value.properties) {
        if (ts.isSpreadAssignment(property)) {
          collect(property.expression, indexes, depth + 1);
        }
      }
      return;
    }
    if (ts.isArrayLiteralExpression(value)) {
      for (const element of value.elements) {
        collect(ts.isSpreadElement(element) ? element.expression : element, indexes, depth + 1);
      }
      return;
    }
    if (ts.isConditionalExpression(value)) {
      collect(value.whenTrue, indexes, depth + 1);
      collect(value.whenFalse, indexes, depth + 1);
      return;
    }
    if (isFunctionLike(value)) {
      for (const expression of evaluator.functionReturns(value)) {
        collect(expression, indexes, depth + 1);
      }
      return;
    }
    if (ts.isIdentifier(value)) {
      const declaration = symbols.declarationOf(value);
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        collect(declaration.initializer, indexes, depth + 1);
      }
      return;
    }
    if (ts.isCallExpression(value)) {
      collectCall(value, indexes, depth);
    }
  }

  function collectCall(call, indexes, depth) {
    const passedThrough = call.arguments.map(unwrapExpression).filter(isActionObject);
    if (passedThrough.length) {
      for (const object of passedThrough) {
        found.push({ object, indexes });
      }
      return;
    }
    const callee = unwrapExpression(call.expression);
    const callback = unwrapExpression(call.arguments[0]);
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "map" && isFunctionLike(callback)) {
      const elements = evaluator.literalArray(callee.expression);
      const returns = evaluator.functionReturns(callback);
      if (!elements) {
        returns.forEach((expression) => collect(expression, indexes, depth + 1));
        return;
      }
      elements.forEach((_, index) => {
        const elementIndexes = new Map(indexes).set(callback, index);
        returns.forEach((expression) => collect(expression, elementIndexes, depth + 1));
      });
      return;
    }
    const implementations = symbols.expressionImplementations(callee, 0).filter(isFunctionLike);
    if (implementations.length) {
      for (const fn of implementations) {
        if (!seenFunctions.has(fn)) {
          seenFunctions.add(fn);
          collect(fn, indexes, depth + 1);
          seenFunctions.delete(fn);
        }
      }
      return;
    }
    if (ts.isPropertyAccessExpression(callee)) {
      collect(callee.expression, indexes, depth + 1);
    }
    for (const argument of call.arguments) {
      collect(argument, indexes, depth + 1);
    }
  }

  const actions = [];
  const executeFunctions = (member) => {
    if (isFunctionLike(member)) {
      return [member];
    }
    if (ts.isPropertyAssignment(member)) {
      return symbols.expressionImplementations(member.initializer, 0).filter(isFunctionLike);
    }
    if (ts.isShorthandPropertyAssignment(member)) {
      return symbols.symbolImplementations(symbols.symbolAt(member.name)).filter(isFunctionLike);
    }
    return [];
  };
  for (const feature of features) {
    found.length = 0;
    if (feature.actionFunctions.length) {
      feature.actionFunctions.forEach((fn) => collect(fn, new Map(), 0));
    } else if (feature.actionsMember && ts.isPropertyAssignment(feature.actionsMember)) {
      collect(feature.actionsMember.initializer, new Map(), 0);
    }
    for (const { object, indexes } of found) {
      const idMember = memberNamed(object, "id");
      const idExpression = ts.isPropertyAssignment(idMember) ? idMember.initializer
        : ts.isShorthandPropertyAssignment(idMember) ? idMember.name : null;
      const actionId = idExpression && evaluator.evaluateLiteral(idExpression, { indexes, values: new Map() });
      actions.push({ actionId, object, execute: executeFunctions(memberNamed(object, "execute")) });
    }
  }
  return actions;
}

export { bindFeatures };
