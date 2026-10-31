import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noSlotSetter } from "../plugin/rules/noSlotSetter.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-slot-setter", noSlotSetter, {
  valid: [
    "function createStore() { function setName(value) { return value; } return { read() {} }; }",
    "const defaults = { setTheme: true };",
    "store.setValue(1);",
    "registry?.setProvider(provider);",
    "function createRuntime() {\n  let provider;\n  return {\n    // readable-check: allow setter-seam - cycle: terminals requires database tools\n    setProvider(next) { provider = next; }\n  };\n}"
  ],
  invalid: [
    {
      code: "function createRuntime() { let provider; return { setProvider(next) { provider = next; } }; }",
      errors: [{ messageId: "setterSeam", data: { setter: "setProvider" } }]
    },
    {
      code: "const runtime = Object.freeze({ setResolver });",
      errors: [{ messageId: "setterSeam", data: { setter: "setResolver" } }]
    },
    {
      code: "runtime.setProvider(provider);",
      errors: [{ messageId: "setterSeam", data: { setter: "runtime.setProvider" } }]
    },
    {
      code: "app.context.setContributors([first, second]);",
      errors: [{ messageId: "setterSeam", data: { setter: "app.context.setContributors" } }]
    }
  ]
});
