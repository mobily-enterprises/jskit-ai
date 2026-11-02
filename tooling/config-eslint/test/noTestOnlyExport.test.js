import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noTestOnlyExport } from "../plugin/rules/noTestOnlyExport.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-test-only-export", noTestOnlyExport, {
  valid: [
    "function createInvoices() {}\nfunction normalizeSlug(value) { return value.trim(); }\nconst __testables = Object.freeze({ normalizeSlug });\nexport { createInvoices, __testables };",
    "export function createInvoices() {}",
    "export const contestingWindow = 3;"
  ],
  invalid: [
    {
      code: "let clock = Date.now;\nexport function setClockForTests(next) { clock = next; }",
      errors: [{ messageId: "testOnlyExport", data: { name: "setClockForTests" } }]
    },
    {
      code: "const cache = new Map();\nfunction resetCache() { cache.clear(); }\nexport { resetCache as __resetCache };",
      errors: [{ messageId: "testOnlyExport", data: { name: "__resetCache" } }]
    },
    {
      code: "export const internalsForTesting = Object.freeze({ cache });",
      errors: [{ messageId: "testOnlyExport", data: { name: "internalsForTesting" } }]
    }
  ]
});
