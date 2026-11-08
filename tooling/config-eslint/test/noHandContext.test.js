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
    "const values = { [key]: value };",
    // The resource runtime defines it; only its call mints a system context.
    "function declareSystemScope(featureId, systemScope) { return scopes.get(featureId); }\nexport const runtime = { declareSystemScope };"
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
      code: "const systemContext = runtime.declareSystemScope(\"billing\", \"read every invoice\");\nconst { declareSystemScope } = resources;",
      errors: [
        { messageId: "systemContext", data: { name: "declareSystemScope" }, line: 1 },
        { messageId: "systemContext", data: { name: "declareSystemScope" }, line: 2 }
      ]
    },
    {
      code: "await bookings.query({}, { context: { scopeValues: { workspaceId } } });",
      errors: [{ messageId: "handScope" }]
    },
    {
      code: "context.scopeValues = { userId };\ncontext.scopeValues.workspaceId = id;",
      errors: [{ messageId: "handScope", line: 1 }, { messageId: "handScope", line: 2 }]
    }
  ]
});
