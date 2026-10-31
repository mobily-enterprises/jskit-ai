import { createReporter, factoryDependencies, ruleMeta } from "../support.js";

// A default that makes a collaborator absent: null, undefined, {}, [] or a no-op.
// A default that is the production implementation (a clock, the global fetch)
// is fine.
const ABSENT_DEFAULT = /^(null|undefined|\{\}|\[\]|(async\s*)?\(\)\s*=>\s*(null|undefined|\{\s*\}|\(\{\s*\}\)|\[\]))$/u;
const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

function compactText(sourceCode, node) {
  return sourceCode.getText(node).replace(/\s+/gu, " ");
}

// Collaborators are required: no absent default, no `typeof x.y === "function"`
// probe and no `x?.y?.()` call. The capability runtime already refuses to start
// without a required token.
const requiredCollaborators = Object.freeze({
  meta: ruleMeta("Require collaborators instead of defaulting, probing or optionally calling them.", {
    dependenciesDefault: "{{name}}'s dependencies default to {{fallback}}, which hides a missing collaborator. Require them.",
    collaboratorDefault: "{{name}} = {{fallback}} makes a collaborator absent. Require it.",
    methodProbe: "typeof {{probe}} probes a collaborator. Require it and call it.",
    optionalCall: "{{callee}}?.() calls a collaborator that may be absent. Require it and call it."
  }),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "required-collaborators");
    function checkDefaults(fn) {
      const dependencies = factoryDependencies(fn, sourceCode);
      if (!dependencies) {
        return;
      }
      const { name, first, pattern, collaborators } = dependencies;
      // `= {}` on the whole object is fine when every property has its own
      // default (an options bag); otherwise it hides a missing collaborator.
      const everyPropertyDefaulted = pattern.properties.every((property) => property.type === "Property" && property.value.type === "AssignmentPattern");
      if (first.type === "AssignmentPattern" && !everyPropertyDefaulted) {
        report(first, "dependency-default", "dependenciesDefault", { name, fallback: sourceCode.getText(first.right) });
      }
      for (const property of pattern.properties) {
        if (property.type !== "Property" || property.value.type !== "AssignmentPattern" || property.value.left.type !== "Identifier") {
          continue;
        }
        const local = property.value.left.name;
        if (!collaborators.has(local) && !FUNCTION_TYPES.has(property.value.right.type)) {
          continue;
        }
        const fallback = compactText(sourceCode, property.value.right);
        if (ABSENT_DEFAULT.test(fallback)) {
          report(property, "dependency-default", "collaboratorDefault", { name: local, fallback: fallback.slice(0, 40) });
        }
      }
    }
    return {
      FunctionDeclaration: checkDefaults,
      FunctionExpression: checkDefaults,
      ArrowFunctionExpression: checkDefaults,
      BinaryExpression(node) {
        if (!["===", "!==", "==", "!="].includes(node.operator)) {
          return;
        }
        const [probe, literal] = node.left.type === "UnaryExpression" ? [node.left, node.right] : [node.right, node.left];
        if (probe?.type !== "UnaryExpression" || probe.operator !== "typeof" || literal?.type !== "Literal" || literal.value !== "function") {
          return;
        }
        const argument = probe.argument.type === "ChainExpression" ? probe.argument.expression : probe.argument;
        if (argument.type === "MemberExpression") {
          report(node, "method-probe", "methodProbe", { probe: sourceCode.getText(probe.argument) });
        }
      },
      CallExpression(node) {
        if (node.optional && node.callee.type === "MemberExpression") {
          report(node, "optional-call", "optionalCall", { callee: sourceCode.getText(node.callee) });
        }
      }
    };
  }
});

export { requiredCollaborators };
