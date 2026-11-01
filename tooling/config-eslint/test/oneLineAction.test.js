import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { oneLineAction } from "../plugin/rules/oneLineAction.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/one-line-action", oneLineAction, {
  valid: [
    "const action = Object.freeze({ id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) });",
    "const action = Object.freeze({ id: \"booking.read\", execute: (input, context) => bookingEngine.update(context.subject, input) });",
    "function normalize(input = {}) { return input || {}; }",
    "const view = { execute: (input = {}) => input };",
    { code: "function begin(input = {}) { return input?.trx; }", filename: "transaction.js" },
    "const action = Object.freeze({\n  id: \"booking.read\",\n  // readable-check: allow input-fallback - called without input by the scheduler\n  execute: (input = {}) => bookingEngine.readStatus(input)\n});",
    "const actions = Object.freeze([Object.freeze({ id: \"booking.read\", execute: (input, context) => bookingEngine.readStatus(input, { context }) })]);",
    "const operations = [{ operation: \"list\", execute: (input, context) => run(\"list\", input, context) }];",
    "const receivalActions = { \"intake-drums\": { id: \"crud.receivals.intakeDrums\", async execute({ input, service }) { return service.recordIntakeDrums(input); } } };",
    "import { deepFreeze } from \"@jskit-ai/kernel/shared/support/deepFreeze\";\nconst actions = deepFreeze([{ id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) }]);",
    "import { deepFreeze as frozen } from \"@jskit-ai/kernel/shared/support\";\nconst action = frozen({ id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) });",
    "const actions = Object.freeze([\n  // readable-check: allow unfrozen-action - data: a fixture the catalogue copies\n  { id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) }\n]);"
  ],
  invalid: [
    {
      code: "const action = Object.freeze({ id: \"booking.read\", execute: (input = {}) => bookingEngine.readStatus(input) });",
      errors: [{ messageId: "inputFallback", data: { fallback: "input = {}" } }]
    },
    {
      code: "const action = Object.freeze({ id: \"booking.read\", execute(input, context) { return bookingEngine.readStatus(input || {}); } });",
      errors: [{ messageId: "inputFallback", data: { fallback: "input || {}" } }]
    },
    {
      code: "const action = Object.freeze({ id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input?.bookingId) });",
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
    },
    {
      code: "const action = Object.freeze({ id: \"auth.logout\", execute: async (input, context) => logoutOutcome(await authService.logout(context)) });",
      errors: [{ messageId: "asyncExecute" }]
    },
    {
      code: "const action = Object.freeze({ id: \"crud.notes.view\", async execute(input, context) { return service.view(input, { context }); } });",
      errors: [{ messageId: "asyncExecute" }]
    },
    {
      code: "const actions = Object.freeze([{ id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) }]);",
      errors: [{ messageId: "unfrozenAction", column: 32 }]
    },
    {
      code: "function createBookingActions({ bookingEngine }) {\n  return [Object.freeze({ id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) })];\n}",
      errors: [{ messageId: "unfrozenActions", line: 2 }]
    },
    {
      code: "function deepFreeze(value) { return value; }\nconst actions = deepFreeze([{ id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) }]);",
      errors: [{ messageId: "unfrozenActions", line: 2 }, { messageId: "unfrozenAction", line: 2 }]
    },
    {
      code: "import { deepFreeze } from \"@jskit-ai/kernel/shared/support/deepFreeze\";\nconst actions = deepFreeze(createList([{ id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) }]));",
      errors: [{ messageId: "unfrozenActions", line: 2 }, { messageId: "unfrozenAction", line: 2 }]
    },
    {
      code: "const actions = [{ id: \"booking.read\", execute: (input) => bookingEngine.readStatus(input) }];",
      errors: [{ messageId: "unfrozenActions", column: 17 }, { messageId: "unfrozenAction", column: 18 }]
    }
  ]
});
