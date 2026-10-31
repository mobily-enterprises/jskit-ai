import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { oneLineAction } from "../plugin/rules/oneLineAction.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/one-line-action", oneLineAction, {
  valid: [
    "const action = { id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) };",
    "const action = { id: \"booking.read\", execute: (input, context) => bookingEngine.update(context.subject, input) };",
    "function normalize(input = {}) { return input || {}; }",
    "const view = { execute: (input = {}) => input };",
    { code: "function begin(input = {}) { return input?.trx; }", filename: "transaction.js" },
    "const action = {\n  id: \"booking.read\",\n  // readable-check: allow input-fallback - called without input by the scheduler\n  execute: (input = {}) => bookingEngine.readStatus(input)\n};"
  ],
  invalid: [
    {
      code: "const action = { id: \"booking.read\", execute: (input = {}) => bookingEngine.readStatus(input) };",
      errors: [{ messageId: "inputFallback", data: { fallback: "input = {}" } }]
    },
    {
      code: "const action = { id: \"booking.read\", execute(input, context) { return bookingEngine.readStatus(input || {}); } };",
      errors: [{ messageId: "inputFallback", data: { fallback: "input || {}" } }]
    },
    {
      code: "const action = { id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input?.bookingId) };",
      errors: [{ messageId: "inputFallback", data: { fallback: "input?.bookingId" } }]
    },
    {
      code: "function toQuery(input = {}) { return { limit: input?.limit }; }",
      filename: "bookingActions.js",
      errors: [
        { messageId: "inputFallback", data: { fallback: "input = {}" } },
        { messageId: "inputFallback", data: { fallback: "input?.limit" } }
      ]
    },
    {
      code: "const query = (input) => input || {};",
      filename: "user-actions.js",
      errors: [{ messageId: "inputFallback", data: { fallback: "input || {}" } }]
    }
  ]
});
