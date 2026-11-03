import { definitionOf, isVueStateCall } from "../factoryResults.js";
import { CLIENT_GUIDE_URL, createReporter, deepFreezeNames, isFreezeCall, keyName, ruleMeta } from "../support.js";

// Whether a member's value is Vue reactive state: a ref(), computed() or reactive() call, or a const the function
// initialises with one.
function holdsVueState(sourceCode, value) {
  if (isVueStateCall(value)) {
    return true;
  }
  const definition = value.type === "Identifier" ? definitionOf(sourceCode, value) : null;
  return definition?.type === "Variable" && isVueStateCall(definition.node.init);
}

// An object holding Vue reactive state stays extensible. reactive() returns a
// frozen object unproxied, so its refs stop unwrapping, and proxyRefs() (which
// Vue also applies to a setup() result and to defineExpose()) throws reading a
// ref of a frozen object. A composable's result has a fixed shape by
// construction, not by Object.freeze.
const noFrozenVueState = Object.freeze({
  meta: ruleMeta("Disallow freezing an object that holds Vue refs, computed values or reactive state.", {
    frozenState: "{{freeze}}() freezes Vue state ({{members}}). reactive() and proxyRefs() need it extensible: return the object as it is."
  }, "fixed-result-shape", CLIENT_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-frozen-vue-state");
    let deepFreezing = new Set();
    return {
      Program(program) {
        deepFreezing = deepFreezeNames(program);
      },
      CallExpression(node) {
        const deep = node.callee.type === "Identifier" && deepFreezing.has(node.callee.name);
        const object = node.arguments[0];
        if (!(isFreezeCall(node) || deep) || object?.type !== "ObjectExpression") {
          return;
        }
        const members = object.properties
          .filter((property) => property.type === "Property" && holdsVueState(sourceCode, property.value))
          .map((property) => keyName(property) || "member");
        if (members.length) {
          report(node, "frozen-state", "frozenState", { freeze: deep ? node.callee.name : "Object.freeze", members: members.slice(0, 4).join(", ") });
        }
      }
    };
  }
});

export { noFrozenVueState };
