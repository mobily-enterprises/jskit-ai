import { createReporter, isActionExecute, keyName, ruleMeta } from "../support.js";

// A callee a reader follows in one step: a name or a member chain, with no
// call inside it.
function isPlainCallee(node) {
  if (node.type === "Identifier" || node.type === "ThisExpression") {
    return true;
  }
  return node.type === "MemberExpression" && isPlainCallee(node.object);
}

function unwrapCall(node) {
  const value = node.type === "AwaitExpression" ? node.argument : node;
  return value.type === "ChainExpression" ? value.expression : value;
}

// The shape problem of an action's execute, or null for
// `execute: (input, context) => service.method(…)`. Its parameters may
// destructure what must not reach the service (`({ workspaceSlug, ...payload },
// context)`), and a CRUD custom action destructures its declaration's
// `({ input, context, service })`. Async and unfrozen definitions are
// one-line-action's to report.
function shapeProblem(value) {
  // A catalogue that normalizes definitions hands each one's execute on as it is.
  if (value.type === "MemberExpression" && !value.computed && value.property.name === "execute") {
    return null;
  }
  if (value.type === "CallExpression") {
    return "wrappedExecute";
  }
  if (value.type === "FunctionExpression" || (value.type === "ArrowFunctionExpression" && value.body.type === "BlockStatement")) {
    return "blockBody";
  }
  if (value.type !== "ArrowFunctionExpression") {
    return "notArrow";
  }
  const body = unwrapCall(value.body);
  if (body.type !== "CallExpression" || !isPlainCallee(body.callee)) {
    return "notOneCall";
  }
  return null;
}

// An action's execute is one expression-bodied arrow that makes one call, so
// each action shows the one service method it reaches.
const actionExecuteShape = Object.freeze({
  meta: ruleMeta("Require an action's execute to be one arrow whose body is one call.", {
    wrappedExecute: "The execute of action {{action}} is built by {{helper}}(). Write the arrow literally: execute: (input, context) => service.method(input, { context }).",
    blockBody: "The execute of action {{action}} has a body. Move the work into the service and make execute one call: (input, context) => service.method(input, { context }).",
    notArrow: "The execute of action {{action}} is not an arrow. Write execute: (input, context) => service.method(input, { context }).",
    notOneCall: "The execute of action {{action}} does not make exactly one call. Return what one service method returns: (input, context) => service.method(input, { context })."
  }),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "action-execute-shape");
    return {
      Property(node) {
        if (!isActionExecute(node, node.parent)) {
          return;
        }
        const messageId = shapeProblem(node.value);
        if (!messageId) {
          return;
        }
        const id = node.parent.properties.find((property) => keyName(property) === "id");
        const idText = id.value.type === "Literal" ? `"${id.value.value}"` : sourceCode.getText(id.value);
        const action = idText.length > 60 ? `${idText.slice(0, 57)}...` : idText;
        const helper = node.value.type === "CallExpression" ? sourceCode.getText(node.value.callee) : "";
        report(node, "execute-shape", messageId, { action, helper });
      }
    };
  }
});

export { actionExecuteShape };
