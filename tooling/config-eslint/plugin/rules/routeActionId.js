import { createReporter, keyName, ruleMeta, walk } from "../support.js";

// `router.register(…)` or `<owner>.router.register(…)`: a route registered with the kernel's router.
function isRouterRegister(callee) {
  if (callee.type !== "MemberExpression" || callee.computed || callee.property.name !== "register") {
    return false;
  }
  const owner = callee.object;
  return (owner.type === "Identifier" && owner.name === "router") ||
    (owner.type === "MemberExpression" && !owner.computed && owner.property.name === "router");
}

// The action ids, as written, of the `executeAction({ actionId, … })` calls in a handler, or null when one of them
// runs its action on a surface or channel of its own, or with context of its own, which the route's check before
// validation would not use.
function handlerActions(handler, sourceCode) {
  const actions = new Set();
  let ownScope = false;
  walk(handler.body, sourceCode.visitorKeys, (node) => {
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed ||
      node.callee.property.name !== "executeAction" || node.arguments[0]?.type !== "ObjectExpression") {
      return;
    }
    const properties = node.arguments[0].properties;
    const actionId = properties.find((property) => keyName(property) === "actionId");
    if (properties.some((property) => ["surface", "channel", "context"].includes(keyName(property)))) {
      ownScope = true;
    }
    if (actionId) {
      actions.add(sourceCode.getText(actionId.value));
    }
  });
  return ownScope ? null : [...actions];
}

// A route whose handler runs one action names it in its options' `actionId`, so the kernel checks that action's
// channel, surface and permission before the route validates or reads what the request sends.
const routeActionId = Object.freeze({
  meta: ruleMeta("Require a route that runs one action to name it in actionId.", {
    missingActionId: "The route {{route}} runs action {{action}} without naming it in actionId, so a caller that action refuses is answered with the route's field errors first. Add actionId: {{action}} to its options; never repeat the action's permission on the route instead."
  }, "routes"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "route-action-id");
    return {
      CallExpression(node) {
        const [method, path, options, handler] = node.arguments;
        if (!isRouterRegister(node.callee) || node.arguments.length !== 4 || options.type !== "ObjectExpression" ||
          !["FunctionExpression", "ArrowFunctionExpression"].includes(handler.type)) {
          return;
        }
        if (options.properties.some((property) => keyName(property) === "actionId")) {
          return;
        }
        const actions = handlerActions(handler, sourceCode);
        if (actions?.length !== 1) {
          return;
        }
        const written = (node) => (node.type === "Literal" ? String(node.value) : sourceCode.getText(node));
        const route = `${written(method)} ${written(path)}`;
        report(options, "route-action-id", "missingActionId", { route, action: actions[0] });
      }
    };
  }
});

export { routeActionId };
