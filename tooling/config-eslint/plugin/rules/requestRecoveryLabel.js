import { CLIENT_GUIDE_URL, createReporter, keyName, receivingFunction, ruleMeta } from "../support.js";

// The screen reads of @jskit-ai/http-web: their screen shows a failed read as loadError, so shell-web's request recovery
// banner leaves them out unless the call asks for it with requestRecovery, and a requestRecoveryLabel without it names
// nothing (the call throws a TypeError when the screen loads).
const SCREEN_READS = new Set([
  "useList",
  "useView",
  "useAddEdit",
  "useCrudList",
  "useCrudView",
  "useCrudAddEdit",
  "useCrudListScreen",
  "useCrudViewScreen",
  "useCrudAddEditScreen"
]);

/** The property `name` of an object literal, written as a name or a string, or null. */
function propertyNamed(object, name) {
  return object.properties.find((property) => property.type === "Property" && !property.computed && keyName(property) === name) || null;
}

const isLiteral = (node, value) => node?.type === "Literal" && node.value === value;

/** Whether a requestRecovery value written in the call leaves the banner out: false, null, undefined or enabled: false. */
function bannerOff(value) {
  if (isLiteral(value, false) || isLiteral(value, null)) return true;
  if (value.type === "Identifier" && value.name === "undefined") return true;
  return value.type === "ObjectExpression" && isLiteral(propertyNamed(value, "enabled")?.value, false);
}

// A screen read given requestRecoveryLabel asks for the banner with requestRecovery: true. What the call does not
// write is the call's own check: a requestRecovery in a variable or a spread, and a label passed on from the function's
// own parameter (a screen composable handing its caller's label to the read under it).
const requestRecoveryLabel = Object.freeze({
  meta: ruleMeta("Disallow requestRecoveryLabel on a screen read whose request recovery banner is off.", {
    labelWithoutRecovery: "{{callee}}() is given requestRecoveryLabel, which names shell-web's request recovery banner, " +
      "but its read leaves the banner out unless requestRecovery is true: its screen shows the failure as loadError, and " +
      "the call throws a TypeError when the screen loads. Pass requestRecovery: true for a read whose screen shows no " +
      "loadError (a lookup's options), or drop requestRecoveryLabel where the screen shows loadError (a CRUD screen " +
      "always does)."
  }, "screen-read-failures", CLIENT_GUIDE_URL),
  create(context) {
    const report = createReporter(context, "request-recovery-label");
    return {
      CallExpression(node) {
        const callee = node.callee.type === "MemberExpression" ? node.callee.property : node.callee;
        if (callee?.type !== "Identifier" || !SCREEN_READS.has(callee.name)) return;
        for (const options of node.arguments.filter((argument) => argument.type === "ObjectExpression")) {
          const label = propertyNamed(options, "requestRecoveryLabel");
          if (!label || (label.value.type === "Identifier" && receivingFunction(context, label.value, label.value.name))) continue;
          const recovery = propertyNamed(options, "requestRecovery");
          const spread = options.properties.some((property) => property.type === "SpreadElement");
          if (recovery ? bannerOff(recovery.value) : !spread) {
            report(label, "request-recovery-label", "labelWithoutRecovery", { callee: callee.name });
          }
        }
      }
    };
  }
});

export { requestRecoveryLabel };
