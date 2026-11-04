import { FUNCTION_TYPES, definedName, definitionOf, enclosingFunction } from "../factoryResults.js";
import { CLIENT_GUIDE_URL, createReporter, keyName, ruleMeta, unwrapAwait } from "../support.js";

const RESULT_FACTORY = /^(create|use)[A-Z]/u;

function calleeName(call) {
  const callee = call.callee;
  return callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && !callee.computed ? callee.property.name : "";
}

// Whether an assigned value adds behaviour: a function, a function the module
// defines, or another factory's or composable's result. Data written into
// reactive state (`state.loading = true`) is not.
function addsBehaviour(sourceCode, value) {
  if (FUNCTION_TYPES.has(value.type)) {
    return true;
  }
  if (value.type === "CallExpression") {
    return RESULT_FACTORY.test(calleeName(value));
  }
  if (value.type !== "Identifier") {
    return false;
  }
  const definition = definitionOf(sourceCode, value);
  return definition?.type === "FunctionName" || (definition?.type === "Variable" && FUNCTION_TYPES.has(definition.node.init?.type));
}

// The create*/use* call a wrapper's callback builds its result with, or null:
// `app.runWithContext(() => createRuntime(readers))` returns that runtime.
function callbackFactoryCall(call) {
  const callback = call.arguments.find((argument) => argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression");
  const last = callback?.body.type === "BlockStatement" ? callback.body.body.at(-1) : null;
  const built = unwrapAwait(callback?.body.type === "BlockStatement" ? (last?.type === "ReturnStatement" ? last.argument : null) : callback?.body);
  return built?.type === "CallExpression" && RESULT_FACTORY.test(calleeName(built)) ? built : null;
}

// What a patched object is, or "": a create*/use* result, directly or through a
// wrapper's callback, or the object a create*/use* builds and returns.
function resultOwner(sourceCode, identifier) {
  const definition = definitionOf(sourceCode, identifier);
  const init = unwrapAwait(definition?.type === "Variable" ? definition.node.init : null);
  const factoryCall = init?.type === "CallExpression" ? (RESULT_FACTORY.test(calleeName(init)) ? init : callbackFactoryCall(init)) : null;
  if (factoryCall) {
    return `${calleeName(factoryCall)}()'s result`;
  }
  if (init?.type !== "ObjectExpression") {
    return "";
  }
  const fn = enclosingFunction(sourceCode, definition.node);
  return fn && RESULT_FACTORY.test(definedName(fn)) ? `${definedName(fn)}()'s result` : "";
}

// A composable's or factory's result has one shape, built once: named members,
// nothing added after construction. A member patched on later is invisible to
// the result's type and to every reader of the factory.
const fixedResultShape = Object.freeze({
  meta: ruleMeta("Disallow adding behaviour to a create*/use* result after it is built.", {
    patchedResult: "{{member}} is added to {{owner}} after it is built. Build it first and list it in the result."
  }, "fixed-result-shape", CLIENT_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "fixed-result-shape");
    function check(node, object, member) {
      const owner = object.type === "Identifier" ? resultOwner(sourceCode, object) : "";
      if (owner) {
        report(node, "patched-result", "patchedResult", { member: `${object.name}.${member}`, owner });
      }
    }
    return {
      AssignmentExpression(node) {
        const target = node.left;
        if (node.operator === "=" && target.type === "MemberExpression" && addsBehaviour(sourceCode, node.right)) {
          check(node, target.object, target.computed ? sourceCode.getText(target.property) : target.property.name);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        const assigns = callee.type === "MemberExpression" && callee.object.name === "Object" && callee.property.name === "assign";
        const [target, ...sources] = node.arguments;
        const added = assigns && target ? sources
          .filter((source) => source.type === "ObjectExpression")
          .flatMap((source) => source.properties)
          .find((property) => property.type === "Property" && addsBehaviour(sourceCode, property.value)) : null;
        if (added) {
          check(node, target, keyName(added) || "member");
        }
      }
    };
  }
});

export { fixedResultShape };
