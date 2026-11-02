import { createReporter, functionName, isWrittenActionDefinition, keyName, ruleMeta } from "../support.js";

const ACTIONS_CREATOR = /^create[A-Z]\w*Actions$/u;
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
// The members of a CRUD custom action's one argument; its definitions belong to the CRUD declaration.
const CRUD_ACTION_MEMBERS = new Set(["input", "service", "repository"]);

function isCrudCustomAction(definition) {
  const execute = definition.properties.find((property) => keyName(property) === "execute");
  const first = execute?.value?.params?.[0];
  return first?.type === "ObjectPattern" && first.properties.some((property) => CRUD_ACTION_MEMBERS.has(keyName(property)));
}

// A feature's actions come from one create<Name>Actions({ … }) that receives the capabilities they call, destructured,
// and returns each definition as a literal: a reader finds every action, and the service it reaches, in one place.
const actionCreator = Object.freeze({
  meta: ruleMeta("Require action definitions to be written inside a create<Name>Actions({ … }) creator.", {
    outsideCreator: "Action {{action}} is defined outside a create<Name>Actions creator. Write it as a literal inside create<Name>Actions({ <capability> }).",
    positionalCreator: "{{name}} receives its capabilities positionally. Destructure them: {{name}}({ <capability> })."
  }, "action-creators"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "action-creator");
    function checkCreator(fn) {
      const name = functionName(fn);
      const first = fn.params[0];
      if (!ACTIONS_CREATOR.test(name) || !first) {
        return;
      }
      const parameter = first.type === "AssignmentPattern" ? first.left : first;
      if (parameter.type !== "ObjectPattern") {
        report(first, "positional-creator", "positionalCreator", { name });
      }
    }
    return {
      FunctionDeclaration: checkCreator,
      FunctionExpression: checkCreator,
      ArrowFunctionExpression: checkCreator,
      ObjectExpression(node) {
        if (!isWrittenActionDefinition(node) || isCrudCustomAction(node)) {
          return;
        }
        const insideCreator = sourceCode.getAncestors(node).some((ancestor) => FUNCTION_TYPES.has(ancestor.type) &&
          ACTIONS_CREATOR.test(functionName(ancestor)));
        if (!insideCreator) {
          const id = node.properties.find((property) => keyName(property) === "id");
          const text = id.value.type === "Literal" ? `"${id.value.value}"` : sourceCode.getText(id.value);
          report(node, "outside-creator", "outsideCreator", { action: text.length > 60 ? `${text.slice(0, 57)}...` : text });
        }
      }
    };
  }
});

export { actionCreator };
