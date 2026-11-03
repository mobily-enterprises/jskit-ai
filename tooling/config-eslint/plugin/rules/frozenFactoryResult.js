import { CREATE_NAME, definedName, holdsBehaviour, isInlineFunction, makesVueState, returnedFrom } from "../factoryResults.js";
import { createReporter, isActionDefinition, isFreezeCall, keyName, ruleMeta } from "../support.js";

// A create* factory that returns behaviour returns Object.freeze({ … }) of
// named functions, so its shape is fixed and each member has a name a reader
// and the code map can follow. A factory that returns plain data is not held
// to it, and action definitions keep their one-line execute. A factory that
// makes Vue reactive state is not frozen either: callers may hand its result to
// reactive() or proxyRefs(), which need it extensible.
const frozenFactoryResult = Object.freeze({
  meta: ruleMeta("Require create* factories to return a frozen object of named functions.", {
    unfrozenResult: "{{factory}}() returns an object that is not frozen. Return Object.freeze({ … }) of named functions.",
    inlineMember: "{{factory}}() defines {{member}} inline in its result. Define a named function and list it in Object.freeze({ … })."
  }, "frozen-results"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "frozen-factory-result");
    function check(node) {
      const result = returnedFrom(sourceCode, node);
      const factory = result ? definedName(result.fn) : "";
      if (!CREATE_NAME.test(factory) || makesVueState(sourceCode, result.fn)) {
        return;
      }
      const frozen = isFreezeCall(result.returned);
      const object = frozen ? result.returned.arguments[0] : result.returned;
      if (object?.type !== "ObjectExpression" || isActionDefinition(object) || !holdsBehaviour(sourceCode, object)) {
        return;
      }
      const inline = object.properties.filter(isInlineFunction);
      if (!frozen) {
        report(object, "unfrozen-result", "unfrozenResult", { factory });
      }
      for (const property of inline) {
        report(property, "inline-member", "inlineMember", { factory, member: keyName(property) || "member" });
      }
    }
    return {
      ReturnStatement: check,
      ArrowFunctionExpression: check
    };
  }
});

export { frozenFactoryResult };
