import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noHandContext } from "../plugin/rules/noHandContext.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-hand-context", noHandContext, {
  valid: [
    "const context = systemContext(\"settle the week's leagues\").forWorkspace(workspaceId);",
    "await bookings.query({ filters }, options);",
    "const workspaceId = context.scopeValues?.workspaceId;",
    "const { systemContext } = dependencies;",
    "const values = { [key]: value };"
  ],
  invalid: [
    {
      code: "import { createSystemContext } from \"json-rest-api\";",
      errors: [{ messageId: "systemContext" }]
    },
    {
      code: "import { createSystemContext as mint } from \"json-rest-api\";",
      errors: [{ messageId: "systemContext" }]
    },
    {
      code: "const context = runtime.createSystemContext({ feature, systemScope, reason });",
      errors: [{ messageId: "systemContext" }]
    },
    {
      code: "const { createSystemContext: mint } = jsonRestApi;",
      errors: [{ messageId: "systemContext" }]
    },
    {
      code: "await bookings.query({}, { context: { scopeValues: { workspaceId } } });",
      errors: [{ messageId: "scopeValues" }]
    },
    {
      code: "context.scopeValues = { userId };\ncontext.scopeValues.workspaceId = id;",
      errors: [{ messageId: "scopeValues", line: 1 }, { messageId: "scopeValues", line: 2 }]
    }
  ]
});
