import { compactText, createReporter, ruleMeta } from "../support.js";

function isProcessEnv(node) {
  return node?.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" &&
    node.object.name === "process" && node.property.name === "env";
}

// Code reads the environment its caller passes. A default of process.env (`env = process.env`, `env || process.env`)
// lets a function read the process's environment on its own, so a caller that forgets to pass one is never told.
// The application passes process.env once, at its entry point.
const noEnvDefault = Object.freeze({
  meta: ruleMeta("Disallow defaulting an environment parameter to process.env.", {
    envDefault: "{{name}} falls back to process.env, so this code reads the environment on its own. Require it, typed RuntimeEnv, and let the application pass process.env at its entry point."
  }, "environment-from-the-caller"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-env-default");
    return {
      AssignmentPattern(node) {
        if (isProcessEnv(node.right)) {
          report(node, "env-default", "envDefault", { name: compactText(sourceCode, node.left) });
        }
      },
      LogicalExpression(node) {
        if ((node.operator === "||" || node.operator === "??") && isProcessEnv(node.right)) {
          report(node, "env-default", "envDefault", { name: compactText(sourceCode, node.left) });
        }
      }
    };
  }
});

export { noEnvDefault };
