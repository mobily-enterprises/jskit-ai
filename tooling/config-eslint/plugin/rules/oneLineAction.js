import {
  createReporter,
  deepFreezeNames,
  functionSite,
  isActionDefinition,
  isActionExecute,
  isActionsFile,
  isFreezeCall,
  isFrozenValue,
  isInAction,
  keyName,
  ruleMeta
} from "../support.js";

function executeOf(definition) {
  return definition.properties.find((property) => keyName(property) === "execute");
}

// The members of a CRUD custom action's one argument that only that contract
// has; an ordinary action that destructures its input names input fields.
const CRUD_ACTION_MEMBERS = new Set(["input", "service", "repository"]);

// A CRUD custom action's execute receives one object, `{ input, service,
// context, … }`: the CRUD declaration's own contract, which the action shape
// leaves alone. It may take only some of it, as `({ service, context })` does.
function isCrudCustomAction(definition) {
  const first = executeOf(definition).value?.params?.[0];
  return first?.type === "ObjectPattern" && first.properties.some((property) => CRUD_ACTION_MEMBERS.has(keyName(property)));
}

// An action definition written in place, bare or frozen.
function definitionLiteral(element) {
  const object = isFreezeCall(element) ? element.arguments[0] : element;
  return object?.type === "ObjectExpression" && isActionDefinition(object) && !isCrudCustomAction(object) ? object : null;
}

// An action validates its input once, against its input schema, and its
// execute hands that input to one service method. In an action's execute, or
// anywhere in an actions file, input is never re-defaulted with `input = {}`,
// `input || {}` or `input?.`. The execute is not `async`, and each definition
// and each list of them is frozen, by Object.freeze or the kernel's deepFreeze.
const oneLineAction = Object.freeze({
  meta: ruleMeta("Require one-line actions: validated input used as is, no async execute, frozen definitions and lists.", {
    inputFallback: "{{fallback}} re-defaults input that the action's schema already validated. Use the validated input.",
    asyncExecute: "An action's execute is async. Return the one service call's result: execute: (input, context) => service.method(…).",
    unfrozenAction: "This action definition is not frozen. Wrap it in Object.freeze({ … }).",
    unfrozenActions: "This list of action definitions is not frozen. Wrap it in Object.freeze([ … ])."
  }, "one-line-execute"),
  create(context) {
    const report = createReporter(context, "one-line-action");
    const actionsFile = isActionsFile(context.filename);
    const deepFreezing = deepFreezeNames(context.sourceCode.ast);
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
      },
      ObjectExpression(node) {
        if (!definitionLiteral(node)) {
          return;
        }
        const execute = executeOf(node);
        if (execute.value?.async) {
          report(execute, "async-execute", "asyncExecute");
        }
        if (!isFrozenValue(node, deepFreezing)) {
          report(node, "unfrozen-action", "unfrozenAction");
        }
      },
      ArrayExpression(node) {
        if (!isFrozenValue(node, deepFreezing) && node.elements.some(definitionLiteral)) {
          report(node, "unfrozen-action", "unfrozenActions");
        }
      }
    };
  }
});

export { oneLineAction };
