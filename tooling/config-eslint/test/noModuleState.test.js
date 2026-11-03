import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import vueParser from "vue-eslint-parser";
import { noModuleState } from "../plugin/rules/noModuleState.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/no-module-state", noModuleState, {
  valid: [
    "const MAX_ITEMS = 20;",
    "const cache = new Map();\nexport function lookup(key) { return cache.get(key); }",
    "import { ref } from \"vue\";\nexport function useCounter() {\n  let clicks = 0;\n  const count = ref(0);\n  return { count, clicks };\n}",
    "// readable-check: allow module-state - shared resource: the page has one microphone, so one conversation holds it\nlet microphoneOwner = null;",
    "import { computed } from \"vue\";\nconst labels = Object.freeze({ a: \"A\" });"
  ],
  invalid: [
    {
      code: "let attachmentSequence = 0;\nexport function nextAttachmentId() { attachmentSequence += 1; return attachmentSequence; }",
      errors: [{ messageId: "moduleBinding", data: { kind: "let", name: "attachmentSequence" } }]
    },
    {
      code: "import { ref } from \"vue\";\nexport const onboardingNeeded = ref(false);",
      errors: [{ messageId: "moduleReactive", data: { name: "onboardingNeeded", call: "ref" } }]
    },
    {
      code: "var context, output;",
      errors: [{ messageId: "moduleBinding", data: { kind: "var", name: "context" } }, { messageId: "moduleBinding", data: { kind: "var", name: "output" } }]
    }
  ]
});

const vueTester = new RuleTester({ languageOptions: { parser: vueParser, ecmaVersion: "latest", sourceType: "module" } });
vueTester.run("jskit/no-module-state (components)", noModuleState, {
  valid: [
    { filename: "Timer.vue", code: "<script setup>\nimport { ref } from \"vue\";\nlet timer;\nconst elapsed = ref(0);\n</script>\n<template><p>{{ elapsed }}</p></template>" }
  ],
  invalid: [
    {
      filename: "Timer.vue",
      code: "<script>\nlet instances = 0;\n</script>\n<script setup>\nlet timer;\n</script>\n<template><p /></template>",
      errors: [{ messageId: "moduleBinding", data: { kind: "let", name: "instances" }, line: 2 }]
    }
  ]
});
