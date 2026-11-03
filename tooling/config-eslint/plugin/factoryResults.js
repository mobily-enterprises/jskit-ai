import { isFreezeCall } from "./support.js";

// What the factory rules share: a function's defined name, what it returns,
// and whether an object it returns holds behaviour or only data.

const CREATE_NAME = /^create[A-Z]/u;
const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);
// Vue's calls that make reactive state. A value holding their results must stay extensible: reactive() returns a
// frozen object unproxied, so its refs stop unwrapping, and proxyRefs() (which Vue also applies to a setup() result
// and to defineExpose()) throws reading a ref of a frozen object.
const VUE_STATE_CALLS = new Set([
  "ref", "shallowRef", "computed", "reactive", "shallowReactive", "readonly", "shallowReadonly", "toRef", "toRefs",
  "customRef", "useTemplateRef", "useModel", "defineModel"
]);

// Whether a call makes Vue reactive state.
function isVueStateCall(node) {
  return node?.type === "CallExpression" && node.callee.type === "Identifier" && VUE_STATE_CALLS.has(node.callee.name);
}

// Whether a function makes Vue reactive state anywhere in its body: a composable or a client runtime, whose result
// callers may hand to reactive() or proxyRefs().
function makesVueState(sourceCode, fn) {
  let found = false;
  const visit = (node) => {
    if (found || !node || typeof node.type !== "string") {
      return;
    }
    if (isVueStateCall(node)) {
      found = true;
      return;
    }
    for (const key of sourceCode.visitorKeys[node.type] || []) {
      [node[key]].flat().forEach(visit);
    }
  };
  visit(fn.body);
  return found;
}

// The name a function is defined under: its own, its variable's, its property's
// or the member it is assigned to.
function definedName(fn) {
  if (fn.id?.name) {
    return fn.id.name;
  }
  const parent = fn.parent;
  if (parent?.type === "VariableDeclarator" && parent.init === fn) {
    return parent.id.name || "";
  }
  if ((parent?.type === "Property" || parent?.type === "MethodDefinition") && parent.value === fn) {
    return parent.key?.name || parent.key?.value || "";
  }
  if (parent?.type === "AssignmentExpression" && parent.right === fn) {
    return parent.left.property?.name || parent.left.name || "";
  }
  return "";
}

// The function a return statement returns from.
function enclosingFunction(sourceCode, node) {
  return sourceCode.getAncestors(node).findLast((ancestor) => FUNCTION_TYPES.has(ancestor.type)) || null;
}

// The expressions a function returns: each return statement's argument, or an
// arrow's expression body. Used from a ReturnStatement or an arrow visitor.
function returnedFrom(sourceCode, node) {
  if (node.type === "ReturnStatement") {
    const fn = enclosingFunction(sourceCode, node);
    return fn && node.argument ? { fn, returned: node.argument } : null;
  }
  return node.body.type === "BlockStatement" ? null : { fn: node, returned: node.body };
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) {
      return variable;
    }
  }
  return null;
}

// The single definition of the variable an identifier reads, or null.
function definitionOf(sourceCode, identifier) {
  const variable = findVariable(sourceCode.getScope(identifier), identifier.name);
  return variable?.defs.length === 1 ? variable.defs[0] : null;
}

function isInlineFunction(property) {
  return property.type === "Property" && property.kind === "init" && (property.method || FUNCTION_TYPES.has(property.value.type));
}

// A member that refers to a function the module or factory defines.
function refersToFunction(sourceCode, property) {
  if (property.type !== "Property" || property.value.type !== "Identifier") {
    return false;
  }
  const definition = definitionOf(sourceCode, property.value);
  return definition?.type === "FunctionName" ||
    (definition?.type === "Variable" && FUNCTION_TYPES.has(definition.node.init?.type));
}

// An object holds behaviour when a member is a function, an accessor or a
// reference to a function; otherwise it is data.
function holdsBehaviour(sourceCode, object) {
  return object.properties.some((property) => isInlineFunction(property) ||
    (property.type === "Property" && property.kind !== "init") || refersToFunction(sourceCode, property));
}

// The function a factory name refers to in this module, or null.
function localFunction(sourceCode, identifier) {
  const definition = definitionOf(sourceCode, identifier);
  if (definition?.type === "FunctionName") {
    return definition.node;
  }
  const init = definition?.type === "Variable" ? definition.node.init : null;
  return FUNCTION_TYPES.has(init?.type) ? init : null;
}

// A module function that returns only data: every value it returns is an
// object literal, frozen or not, without behaviour.
function returnsOnlyData(sourceCode, fn) {
  const returned = [];
  if (fn.body.type !== "BlockStatement") {
    returned.push(fn.body);
  } else {
    const visit = (node) => {
      if (!node || typeof node.type !== "string" || (node !== fn && FUNCTION_TYPES.has(node.type))) {
        return;
      }
      if (node.type === "ReturnStatement") {
        returned.push(node.argument);
      }
      for (const key of sourceCode.visitorKeys[node.type] || []) {
        [node[key]].flat().forEach(visit);
      }
    };
    visit(fn.body);
  }
  return returned.length > 0 && returned.every((value) => {
    const object = isFreezeCall(value) ? value.arguments[0] : value;
    return object?.type === "ObjectExpression" && !holdsBehaviour(sourceCode, object);
  });
}

export {
  CREATE_NAME,
  FUNCTION_TYPES,
  VUE_STATE_CALLS,
  definedName,
  definitionOf,
  enclosingFunction,
  holdsBehaviour,
  isInlineFunction,
  isVueStateCall,
  localFunction,
  makesVueState,
  returnedFrom,
  returnsOnlyData
};
