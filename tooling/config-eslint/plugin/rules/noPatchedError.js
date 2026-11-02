import { compactText, createReporter, keyName, ruleMeta } from "../support.js";

const STATUS_KEYS = new Set(["statusCode", "status"]);
const ERROR_CLASS = /Error$/u;
const ERROR_BUILDER = /(?:error|failure)$/iu;

function calleeName(node) {
  if (node.type === "Identifier") {
    return node.name;
  }
  return node.type === "MemberExpression" && !node.computed ? node.property.name || "" : "";
}

// The error Object.assign patches: a new <X>Error(…) or a call to an error builder (`failure(…)`, `toInputError(…)`).
function isConstructedError(node) {
  if (node?.type === "NewExpression") {
    return ERROR_CLASS.test(calleeName(node.callee));
  }
  return node?.type === "CallExpression" && ERROR_BUILDER.test(calleeName(node.callee));
}

// A refusal is built in one construction, `new AppError(status, message, { code })`, never an Error given its HTTP
// status afterwards: `Object.assign(new Error("Not found."), { statusCode: 404 })`.
const noPatchedError = Object.freeze({
  meta: ruleMeta("Disallow giving an error its HTTP status after construction with Object.assign.", {
    patchedError: "{{error}} is given its HTTP status after construction. A refusal is one construction, new AppError(status, message, { code }); an internal failure is a plain new Error(message) with no status."
  }, "one-construction-per-error"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-patched-error");
    return {
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "MemberExpression" || callee.object.name !== "Object" || callee.property.name !== "assign") {
          return;
        }
        const [target, patch] = node.arguments;
        if (!isConstructedError(target) || patch?.type !== "ObjectExpression") {
          return;
        }
        if (patch.properties.some((property) => property.type === "Property" && STATUS_KEYS.has(keyName(property)))) {
          const text = compactText(sourceCode, target);
          report(node, "patched-error", "patchedError", { error: text.length > 60 ? `${text.slice(0, 57)}...` : text });
        }
      }
    };
  }
});

export { noPatchedError };
