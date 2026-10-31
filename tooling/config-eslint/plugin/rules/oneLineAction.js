import { createReporter, functionSite, isActionExecute, isActionsFile, isInAction, ruleMeta } from "../support.js";

// An action validates its input once, against its input schema, and its
// execute hands that input to one service method. In an action's execute, or
// anywhere in an actions file, input is never re-defaulted with `input = {}`,
// `input || {}` or `input?.`.
const oneLineAction = Object.freeze({
  meta: ruleMeta("Disallow re-defaulting action input that the action's schema already validated.", {
    inputFallback: "{{fallback}} re-defaults input that the action's schema already validated. Use the validated input."
  }),
  create(context) {
    const report = createReporter(context, "one-line-action");
    const actionsFile = isActionsFile(context.filename);
    function checkParameters(fn) {
      const first = fn.params[0];
      if (first?.type !== "AssignmentPattern" || first.left.name !== "input") {
        return;
      }
      if (actionsFile || isActionExecute(fn.parent, fn.parent?.parent)) {
        report(functionSite(fn), "input-fallback", "inputFallback", { fallback: "input = {}" });
      }
    }
    return {
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      ArrowFunctionExpression: checkParameters,
      LogicalExpression(node) {
        if (node.operator === "||" && node.left.type === "Identifier" && node.left.name === "input" &&
          node.right.type === "ObjectExpression" && isInAction(context, node)) {
          report(node, "input-fallback", "inputFallback", { fallback: "input || {}" });
        }
      },
      MemberExpression(node) {
        if (node.optional && node.object.type === "Identifier" && node.object.name === "input" && isInAction(context, node)) {
          report(node, "input-fallback", "inputFallback", { fallback: `input?.${node.property.name || ""}` });
        }
      }
    };
  }
});

export { oneLineAction };
