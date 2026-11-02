import { CREATE_NAME, FUNCTION_TYPES, definedName, definitionOf, enclosingFunction, holdsBehaviour, localFunction, returnsOnlyData } from "../factoryResults.js";
import { createReporter, isFreezeCall, ruleMeta } from "../support.js";

// A decorator over the JSKIT CRUD service or repository spreads it: its
// members are the contract's.
const CRUD_DECORATOR = /^decorate\w*(?:Service|Repository)$/u;

function unwrap(node) {
  return node?.type === "AwaitExpression" ? node.argument : node;
}

// The create* call a spread argument comes from: the call itself, or the call
// that initialised the variable it reads.
function factoryCall(sourceCode, argument) {
  const value = unwrap(argument);
  if (value.type === "Identifier") {
    const definition = definitionOf(sourceCode, value);
    const init = unwrap(definition?.type === "Variable" ? definition.node.init : null);
    return init?.type === "CallExpression" ? { call: init, via: value.name } : null;
  }
  return value.type === "CallExpression" ? { call: value, via: "" } : null;
}

// The factory a spread argument comes from, or null when it is data: a
// create* call whose function, when this module defines it, returns behaviour.
function spreadFactory(sourceCode, argument) {
  const found = factoryCall(sourceCode, argument);
  const callee = found?.call.callee;
  const name = callee?.type === "Identifier" ? callee.name : callee?.type === "MemberExpression" ? callee.property.name || "" : "";
  if (!CREATE_NAME.test(name)) {
    return null;
  }
  const fn = callee.type === "Identifier" ? localFunction(sourceCode, callee) : null;
  if (fn && returnsOnlyData(sourceCode, fn)) {
    return null;
  }
  return found.via ? `${found.via} from ${name}()` : `${name}()`;
}

// The object that an object containing a spread is part of, walking out
// through Object.freeze() calls and property values, with the function that
// returns it: a create* factory's API or a setup() hook's token values.
function returnedApi(sourceCode, object) {
  let node = object;
  for (;;) {
    const parent = node.parent;
    if (isFreezeCall(parent) && parent.arguments[0] === node) {
      node = parent;
    } else if (parent?.type === "Property" && parent.value === node && parent.parent.type === "ObjectExpression") {
      node = parent.parent;
    } else if (parent?.type === "ReturnStatement") {
      const fn = enclosingFunction(sourceCode, parent);
      return fn ? { fn, owner: definedName(fn) } : null;
    } else if (FUNCTION_TYPES.has(parent?.type) && parent.body === node) {
      return { fn: parent, owner: definedName(parent) };
    } else {
      return null;
    }
  }
}

// A factory's API and a token's value name each member, so a reader sees where
// each comes from, and a later spread cannot silently replace an earlier
// member. Spreading plain data stays allowed, as does a CRUD decorator's spread
// of the service or repository it decorates.
const noFactorySpread = Object.freeze({
  meta: ruleMeta("Disallow spreading another factory's result into a factory's API or a token value.", {
    factorySpread: "{{owner}}() spreads {{factory}} into its result. Build the factory once and name each member it exposes."
  }, "named-members"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-factory-spread");
    return {
      SpreadElement(node) {
        const object = node.parent;
        const api = object.type === "ObjectExpression" ? returnedApi(sourceCode, object) : null;
        if (!api || !(CREATE_NAME.test(api.owner) || api.owner === "setup")) {
          return;
        }
        if ([api.fn, ...sourceCode.getAncestors(api.fn)].some((ancestor) => FUNCTION_TYPES.has(ancestor.type) && CRUD_DECORATOR.test(definedName(ancestor)))) {
          return;
        }
        // A factory's data result (an options bag, a request input) may spread data.
        if (api.owner !== "setup" && !isFreezeCall(object.parent) && !holdsBehaviour(sourceCode, object)) {
          return;
        }
        const factory = spreadFactory(sourceCode, node.argument);
        if (factory) {
          report(node, "factory-spread", "factorySpread", { owner: api.owner, factory });
        }
      }
    };
  }
});

export { noFactorySpread };
