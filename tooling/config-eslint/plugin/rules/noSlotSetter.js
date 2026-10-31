import { createReporter, followsOptionalLink, ruleMeta } from "../support.js";

const SETTER_NAME = /^set[A-Z]\w*$/u;

// The setters whose call fills another object's slot.
const SLOT_SETTER_CALL = /(Provider|Resolver|Observer|Owner|Preparation|Completed|Contributors|Reader)$/u;

function isFreezeCall(node) {
  return node.type === "CallExpression" && node.callee.property?.name === "freeze";
}

// An extension slot is an optional capability whose default the declaring
// package names, resolved once in setup(), not a set<Name>() that fills it
// after construction.
const noSlotSetter = Object.freeze({
  meta: ruleMeta("Disallow set<Name>() functions that fill an extension slot after construction.", {
    setterSeam: "{{setter}}() fills a slot after construction. Declare the slot as an optional capability with a named default."
  }),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-slot-setter");
    return {
      Property(node) {
        const name = node.key?.name || "";
        if (!SETTER_NAME.test(name)) {
          return;
        }
        if (sourceCode.getAncestors(node).some((ancestor) => ancestor.type === "ReturnStatement" || isFreezeCall(ancestor))) {
          report(node, "setter-seam", "setterSeam", { setter: name });
        }
      },
      CallExpression(node) {
        const name = node.callee.type === "MemberExpression" ? node.callee.property.name || "" : "";
        if (SETTER_NAME.test(name) && SLOT_SETTER_CALL.test(name) && !followsOptionalLink(node)) {
          report(node, "setter-seam", "setterSeam", { setter: sourceCode.getText(node.callee) });
        }
      }
    };
  }
});

export { noSlotSetter };
