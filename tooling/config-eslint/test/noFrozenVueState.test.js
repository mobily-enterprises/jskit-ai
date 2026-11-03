import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noFrozenVueState } from "../plugin/rules/noFrozenVueState.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-frozen-vue-state", noFrozenVueState, {
  valid: [
    "import { ref } from \"vue\";\nexport function useCounter() {\n  const count = ref(0);\n  function increment() { count.value += 1; }\n  return { count, increment };\n}",
    "export function createApi({ request }) {\n  function list() { return request(\"/items\"); }\n  return Object.freeze({ list });\n}",
    "const LABELS = Object.freeze({ open: \"Open\", closed: \"Closed\" });"
  ],
  invalid: [
    {
      code: "import { computed, ref } from \"vue\";\nexport function useSelection() {\n  const selected = ref([]);\n  const count = computed(() => selected.value.length);\n  return Object.freeze({ selected, count });\n}",
      errors: [{ messageId: "frozenState", data: { freeze: "Object.freeze", members: "selected, count" } }]
    },
    {
      code: "import { ref } from \"vue\";\nimport { deepFreeze } from \"@jskit-ai/kernel/shared/support/deepFreeze\";\nconst state = deepFreeze({ open: ref(false) });",
      errors: [{ messageId: "frozenState", data: { freeze: "deepFreeze", members: "open" } }]
    }
  ]
});
