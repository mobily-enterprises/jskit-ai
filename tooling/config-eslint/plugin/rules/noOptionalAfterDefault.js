import { compactText, createReporter, ruleMeta } from "../support.js";

// Defaults that are never null or undefined: an object, array, string, number,
// boolean, template, function or constructed value.
const PRESENT_DEFAULTS = new Set([
  "ObjectExpression",
  "ArrayExpression",
  "TemplateLiteral",
  "ArrowFunctionExpression",
  "FunctionExpression",
  "ClassExpression",
  "NewExpression"
]);

function isPresentDefault(node) {
  return PRESENT_DEFAULTS.has(node.type) || (node.type === "Literal" && node.value !== null);
}

// The names a parameter list gives a present default, with that default:
// `options = {}`, and `{ env = {} } = {}` or `{ env = {} }` destructured.
function defaultedNames(pattern, found = []) {
  if (!pattern) {
    return found;
  }
  if (pattern.type === "AssignmentPattern") {
    if (pattern.left.type === "Identifier") {
      if (isPresentDefault(pattern.right)) {
        found.push({ name: pattern.left.name, fallback: pattern.right });
      }
      return found;
    }
    return defaultedNames(pattern.left, found);
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      defaultedNames(property.type === "Property" ? property.value : null, found);
    }
  }
  if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) {
      defaultedNames(element, found);
    }
  }
  return found;
}

// A parameter that has a present default is never absent in its function, so
// it needs no `?.` and no second `|| {}` or `|| []`.
const noOptionalAfterDefault = Object.freeze({
  meta: ruleMeta("Disallow optional chaining or a second default on a parameter that already has a default.", {
    optionalAfterDefault: "{{name}} defaults to {{fallback}}, so {{use}} guards a value that is never absent. Use {{name}} directly.",
    defaultAfterDefault: "{{name}} defaults to {{fallback}}, so {{use}} defaults it twice. Use {{name}} directly."
  }, "options-and-defaults"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-optional-after-default");
    function check(fn) {
      const defaulted = fn.params.flatMap((parameter) => defaultedNames(parameter));
      if (!defaulted.length) {
        return;
      }
      const variables = sourceCode.getDeclaredVariables(fn);
      for (const { name, fallback } of defaulted) {
        const variable = variables.find((candidate) => candidate.name === name);
        // A parameter reassigned in the body may become absent again.
        if (!variable || variable.references.some((reference) => reference.isWrite() && !reference.init)) {
          continue;
        }
        const fallbackText = compactText(sourceCode, fallback);
        const data = { name, fallback: fallbackText.length > 30 ? `${fallbackText.slice(0, 27)}...` : fallbackText };
        for (const { identifier } of variable.references) {
          const parent = identifier.parent;
          if ((parent.type === "MemberExpression" && parent.object === identifier && parent.optional) ||
            (parent.type === "CallExpression" && parent.callee === identifier && parent.optional)) {
            report(identifier, "optional-after-default", "optionalAfterDefault", { ...data, use: `${name}?.` });
          } else if (parent.type === "LogicalExpression" && parent.left === identifier && ["||", "??"].includes(parent.operator) &&
            ["ObjectExpression", "ArrayExpression"].includes(parent.right.type) && parent.right.type === fallback.type) {
            report(parent, "default-after-default", "defaultAfterDefault", { ...data, use: `${name} ${parent.operator} ${compactText(sourceCode, parent.right).slice(0, 30)}` });
          }
        }
      }
    }
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check
    };
  }
});

export { noOptionalAfterDefault };
