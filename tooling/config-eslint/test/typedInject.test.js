import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { typedInject } from "../plugin/rules/typedInject.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const IMPORT = "import { inject } from \"vue\";\n";

new RuleTester().run("jskit/typed-inject", typedInject, {
  valid: [
    `${IMPORT}/** @returns {import("./types.js").ErrorRuntime} */\nfunction useErrorRuntime() {\n  return inject(ERROR_RUNTIME_KEY);\n}`,
    `${IMPORT}/** @type {import("./types.js").ScopeSupport} */\nconst support = inject(SCOPE_SUPPORT_KEY, NO_SCOPE_SUPPORT);`,
    `${IMPORT}const placement = /** @type {import("./types.js").Placement} */ (inject(PLACEMENT_KEY));`,
    `${IMPORT}/**\n * The page's realtime socket.\n * @returns {Socket}\n */\nexport function useSocket() {\n  return inject(SOCKET_KEY);\n}`,
    // Not Vue's inject.
    "import { inject } from \"./container.js\";\nconst value = inject(\"token\", null);",
    `${IMPORT}// readable-check: allow untyped-inject - data: the host passes a plain label\nconst label = inject("label");`
  ],
  invalid: [
    {
      code: `${IMPORT}const socket = inject("jskit.realtime.socket", null);`,
      errors: [{ messageId: "literalKey" }, { messageId: "untypedInject" }, { messageId: "absentDefault", data: { fallback: "null" } }]
    },
    {
      code: `${IMPORT}/** @type {Defaults} */\nconst defaults = inject(DEFAULTS_KEY, {});`,
      errors: [{ messageId: "absentDefault", data: { fallback: "{}" } }]
    },
    {
      code: `${IMPORT}function usePlacement() {\n  const placement = inject(PLACEMENT_KEY);\n  return placement;\n}`,
      errors: [{ messageId: "untypedInject", data: { key: "PLACEMENT_KEY" } }]
    },
    {
      code: "import { inject as injectValue } from \"vue\";\n/** @type {Host} */\nconst host = injectValue(`toolbar`);",
      errors: [{ messageId: "literalKey", data: { key: "`toolbar`" } }]
    }
  ]
});
