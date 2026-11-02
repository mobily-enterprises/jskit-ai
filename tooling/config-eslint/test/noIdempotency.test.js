import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noIdempotency } from "../plugin/rules/noIdempotency.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-idempotency", noIdempotency, {
  valid: [
    "Object.freeze({ id: ACTION_CREATE, kind: \"command\", input: createInput, execute: (input) => invoices.create(input) });",
    "client.post(\"/subscriptions\", { idempotencyKey: intentId, body });",
    "const policy = { idempotency: \"provider window\" };"
  ],
  invalid: [
    {
      code: "Object.freeze({ id: ACTION_CREATE, kind: \"command\", idempotency: \"optional\", input: createInput, execute: (input) => invoices.create(input) });",
      errors: [{ messageId: "idempotency" }]
    },
    {
      code: "const COMMAND = Object.freeze({ version: 1, kind: \"command\", channels: [\"api\"], idempotency: \"domain_native\" });",
      errors: [{ messageId: "idempotency" }]
    }
  ]
});
