import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noPatchedError } from "../plugin/rules/noPatchedError.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-patched-error", noPatchedError, {
  valid: [
    "throw new AppError(404, \"Invoice was not found.\", { code: \"billing.invoice.notFound\" });",
    "throw new Error(\"The ledger is out of order.\");",
    "const reply = Object.assign(createReply(), { status: 200 });",
    "const error = Object.assign(new Error(\"Upstream closed.\"), { cause });",
    "Object.assign(options, { status: \"open\" });"
  ],
  invalid: [
    {
      code: "throw Object.assign(new Error(\"Invoice was not found.\"), { statusCode: 404 });",
      errors: [{ messageId: "patchedError", data: { error: "new Error(\"Invoice was not found.\")" } }]
    },
    {
      code: "throw Object.assign(new TypeError(\"Name is required.\"), { status: 400, code: \"name_required\" });",
      errors: [{ messageId: "patchedError" }]
    },
    {
      code: "throw Object.assign(failure(\"Session is closed.\", \"session_closed\"), { statusCode: 409 });",
      errors: [{ messageId: "patchedError", data: { error: "failure(\"Session is closed.\", \"session_closed\")" } }]
    }
  ]
});
