import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import vueParser from "vue-eslint-parser";
import { collaboratorProps } from "../plugin/rules/collaboratorProps.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const component = (script, template = "<p />") => `<script setup>\n${script}\n</script>\n<template>${template}</template>\n`;
const GOAL_TYPE = "/** @type {import(\"vue\").PropType<import(\"./types.js\").GoalState>} */ (Object)";

new RuleTester({ languageOptions: { parser: vueParser, ecmaVersion: "latest", sourceType: "module" } }).run("jskit/collaborator-props", collaboratorProps, {
  valid: [
    {
      filename: "GoalControl.vue",
      code: component(`const props = defineProps({\n  state: { type: ${GOAL_TYPE}, required: true }\n});\nfunction start() { return props.state.set({ objective: "x" }); }`)
    },
    {
      filename: "Attachments.vue",
      code: component("const props = defineProps({\n  items: { type: Array, default: () => [] },\n  label: { type: String, default: \"\" }\n});\nconst names = props.items.map((item) => item.name);\nconst title = props.label.trim();")
    },
    {
      filename: "LoadError.vue",
      code: component("function ignoreReload() {}\nconst props = defineProps({\n  reload: { type: Function, default: ignoreReload }\n});", "<button @click=\"reload()\" />")
    },
    {
      filename: "Status.vue",
      code: component("defineProps({\n  message: { type: Object, required: true }\n});", "<p>{{ message.text }}</p>")
    }
  ],
  invalid: [
    {
      filename: "GoalControl.vue",
      code: component("const props = defineProps({ state: { type: Object, default: null } });\nconst ready = () => props.state?.set?.({});"),
      errors: [{ messageId: "optionalCollaborator", data: { name: "state", fallback: " and defaults to null" } }, { messageId: "untypedCollaborator", data: { name: "state", type: "Object" } }]
    },
    {
      filename: "LoadError.vue",
      code: component("defineProps({\n  reload: { type: Function, default: null }\n});", "<button @click=\"reload()\" />"),
      errors: [{ messageId: "optionalCollaborator", data: { name: "reload", fallback: " and defaults to null" } }]
    },
    {
      filename: "Conversation.vue",
      code: component("defineProps({\n  adapter: { type: Object, required: true }\n});", "<button @click=\"adapter.resend(id)\" />"),
      errors: [{ messageId: "untypedCollaborator", data: { name: "adapter", type: "Object" } }]
    },
    {
      filename: "Dialog.vue",
      code: component("const props = defineProps({\n  activator: { type: Object }\n});\nfunction open() { props.activator.focus(); }"),
      errors: [{ messageId: "optionalCollaborator", data: { name: "activator", fallback: "" } }, { messageId: "untypedCollaborator" }]
    },
    {
      filename: "Dialog.vue",
      code: component("defineProps({\n  activator: Object,\n  title: String\n});", "<button @click=\"activator.focus()\">{{ title.trim() }}</button>"),
      errors: [{ messageId: "optionalCollaborator", data: { name: "activator", fallback: "" } }, { messageId: "untypedCollaborator", data: { name: "activator", type: "Object" } }]
    }
  ]
});
