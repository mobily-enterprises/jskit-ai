import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noDualShape } from "../plugin/rules/noDualShape.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-dual-shape", noDualShape, {
  valid: [
    "const audits = auditsCapability.service;",
    "const name = profile.displayName || profile.email;",
    "try { run(); } catch (error) { logger.warn({ error: String(error?.message || error) }); }",
    "const items = response.items || [];",
    "const selected = options.service ? options.service : defaultService;",
    "// readable-check: allow dual-shape - data: a GitHub owner is a login string or an account object\nconst owner = value.owner?.login || value.owner;"
  ],
  invalid: [
    {
      code: "function serviceOf(capability) { return capability.service || capability; }",
      errors: [{ messageId: "dualShape", data: { expression: "capability.service || capability", member: "capability.service", whole: "capability" } }]
    },
    {
      code: "const history = aiHistory?.service || aiHistory;",
      errors: [{ messageId: "dualShape", data: { expression: "aiHistory?.service || aiHistory", member: "aiHistory.service", whole: "aiHistory" } }]
    },
    {
      code: "function resultValue({ result } = {}) { return result?.value ?? result ?? {}; }",
      errors: [{ messageId: "dualShape", data: { expression: "result?.value ?? result", member: "result.value", whole: "result" } }]
    },
    {
      code: "reply.code(200).send(result?.response || result);",
      errors: [{ messageId: "dualShape" }]
    },
    {
      code: "const audits = this.audits.service ? this.audits.service : this.audits;",
      errors: [{ messageId: "dualShape", data: { expression: "this.audits.service ? this.audits.service : this.audits", member: "this.audits.service", whole: "this.audits" } }]
    }
  ]
});
