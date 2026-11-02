import { createReporter, keyName, ruleMeta } from "../support.js";

// The keys only an action definition, a CRUD custom action or their shared-field constant hold.
const ACTION_KEYS = new Set(["execute", "kind", "channels", "surfaces", "permission"]);

// JSKIT has no idempotency machinery, and the kernel refuses an action definition that declares one at startup. An
// action that must tolerate a repeated request handles it in its own domain.
const noIdempotency = Object.freeze({
  meta: ruleMeta("Disallow an idempotency field on action definitions.", {
    idempotency: "Action definitions declare no idempotency; the kernel refuses the field at startup. Remove it, and handle a repeated request in the domain (a unique key, an upsert, a state check)."
  }, "no-idempotency"),
  create(context) {
    const report = createReporter(context, "no-idempotency");
    return {
      ObjectExpression(node) {
        const keys = node.properties.map(keyName);
        if (!keys.includes("idempotency") || !keys.some((key) => ACTION_KEYS.has(key))) {
          return;
        }
        report(node.properties.find((property) => keyName(property) === "idempotency"), "idempotency", "idempotency");
      }
    };
  }
});

export { noIdempotency };
