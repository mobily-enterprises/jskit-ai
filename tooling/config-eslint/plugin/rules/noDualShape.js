import { createReporter, ruleMeta } from "../support.js";

const REFERENCE_TYPES = new Set(["Identifier", "MemberExpression", "ThisExpression"]);

function unwrapChain(node) {
  return node?.type === "ChainExpression" ? node.expression : node;
}

// A reference's text with optional links read as plain ones, so `a?.b` and
// `a.b` name the same value.
function referenceText(sourceCode, node) {
  const value = unwrapChain(node);
  return value && REFERENCE_TYPES.has(value.type) ? sourceCode.getText(value).replace(/\?\./gu, ".").replace(/\s+/gu, "") : null;
}

// The member read off a value that the expression falls back to as a whole:
// `x.service || x`, `x?.service ?? x`, `x.service ? x.service : x`.
function dualShape(sourceCode, member, fallback) {
  const value = unwrapChain(member);
  // `error.message || error` reads an error's text, whatever was thrown.
  if (value?.type !== "MemberExpression" || value.computed || value.property.name === "message") {
    return false;
  }
  const whole = referenceText(sourceCode, value.object);
  return whole !== null && whole === referenceText(sourceCode, fallback);
}

// A collaborator arrives in one shape: the type promises one, production takes
// one branch and test doubles take the other. `x.service || x` accepts both.
const noDualShape = Object.freeze({
  meta: ruleMeta("Disallow accepting a value in two shapes, such as x.service || x.", {
    dualShape: "{{expression}} accepts {{whole}} in two shapes. Accept one: read {{member}}, or use {{whole}} as it is, and give test doubles the real shape."
  }),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-dual-shape");
    function reportShape(node, member, whole) {
      const expression = sourceCode.getText(node).replace(/\s+/gu, " ");
      report(node, "dual-shape", "dualShape", {
        expression: expression.length > 60 ? `${expression.slice(0, 57)}...` : expression,
        member: sourceCode.getText(unwrapChain(member)).replace(/\?\./gu, "."),
        whole: sourceCode.getText(unwrapChain(whole))
      });
    }
    return {
      LogicalExpression(node) {
        if ((node.operator === "||" || node.operator === "??") && dualShape(sourceCode, node.left, node.right)) {
          reportShape(node, node.left, node.right);
        }
      },
      ConditionalExpression(node) {
        if (dualShape(sourceCode, node.consequent, node.alternate) &&
          referenceText(sourceCode, node.test) === referenceText(sourceCode, node.consequent)) {
          reportShape(node, node.consequent, node.alternate);
        }
      }
    };
  }
});

export { noDualShape };
