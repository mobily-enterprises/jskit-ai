import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { RuleTester } from "eslint";
import vueParser from "vue-eslint-parser";
import { allowCommentForm } from "../plugin/rules/allowCommentForm.js";
import { frozenFactoryResult } from "../plugin/rules/frozenFactoryResult.js";
import { noDuplicateHelper } from "../plugin/rules/noDuplicateHelper.js";
import { noFactorySpread } from "../plugin/rules/noFactorySpread.js";
import { noSlotSetter } from "../plugin/rules/noSlotSetter.js";
import { requiredCollaborators } from "../plugin/rules/requiredCollaborators.js";
import { typedDependencies } from "../plugin/rules/typedDependencies.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// The settings clientFeaturesConfig gives the files it selects.
const CLIENT = Object.freeze({ settings: { jskit: { client: true } } });
const client = new RuleTester(CLIENT);
const server = new RuleTester();
const components = new RuleTester({ ...CLIENT, languageOptions: { parser: vueParser, ecmaVersion: "latest", sourceType: "module" } });

const COMPOSABLE = "export function useAttachments({ uploadAttachment, onUploaded }) {\n  return { add: (file) => uploadAttachment(file).then(onUploaded) };\n}";

client.run("jskit/typed-dependencies (client)", typedDependencies, {
  valid: [
    `/** @param {{ uploadAttachment: AttachmentUpload, onUploaded: (attachment: Attachment) => void }} options */\n${COMPOSABLE}`,
    "export function useLabel({ label }) { return { text: `${label}!` }; }"
  ],
  invalid: [
    { code: COMPOSABLE, errors: [{ messageId: "untypedDependencies", data: { name: "useAttachments", collaborators: "uploadAttachment" } }] }
  ]
});
server.run("jskit/typed-dependencies (server code keeps create* and build*)", typedDependencies, {
  valid: [COMPOSABLE],
  invalid: []
});

client.run("jskit/required-collaborators (client)", requiredCollaborators, {
  valid: [
    "function ignorePlayback() {}\nexport function useTransport({ onPlayback = ignorePlayback, socket }) { socket.send(\"x\"); onPlayback(); }",
    "export function useAttachments({ deleteAttachment }) {\n  // readable-check: allow method-probe - optional operation: a read-only queue has no deleteAttachment\n  const canDelete = typeof deleteAttachment === \"function\";\n  return { canDelete };\n}"
  ],
  invalid: [
    {
      code: "export function useAttachments({ uploadAttachment = null }) {\n  if (typeof uploadAttachment !== \"function\") return null;\n  return uploadAttachment();\n}",
      errors: [{ messageId: "collaboratorDefault", data: { name: "uploadAttachment", fallback: "null" } }, { messageId: "methodProbe" }]
    },
    {
      code: "export function useTransport({ socket, onPlayback = () => {} }) { socket.send(\"x\"); onPlayback(); }",
      errors: [{ messageId: "collaboratorDefault", data: { name: "onPlayback", fallback: "() => {}" } }]
    }
  ]
});
const ADAPTER_PROPS = "<script setup>\ndefineProps({ adapter: { type: Object, required: true } });\n</script>\n";
components.run("jskit/required-collaborators (templates)", requiredCollaborators, {
  valid: [
    {
      filename: "LoadError.vue",
      code: `${ADAPTER_PROPS}<template>\n  <!-- readable-check: allow optional-call - optional operation: a read-only transcript has no reload -->\n  <button\n    class="reload"\n    @click="adapter.actions.reload?.()" />\n</template>\n`
    },
    { filename: "Status.vue", code: "<script setup>\ndefineProps({ adapter: { type: Object, required: true } });\n</script>\n<template><button @click=\"adapter.resend(id)\" /></template>\n" },
    { filename: "Status.vue", code: "<script setup>\ndefineProps({ entry: { type: Object, required: true } });\n</script>\n<template><p>{{ entry?.label }}</p></template>\n" }
  ],
  invalid: [
    {
      filename: "Conversation.vue",
      code: "<script setup>\ndefineProps({ adapter: { type: Object, required: true } });\n</script>\n<template><button @click=\"adapter.delivery?.resend?.(id)\" /></template>\n",
      errors: [{ messageId: "optionalCall", data: { callee: "adapter.delivery?.resend" }, line: 4 }]
    },
    {
      filename: "LoadError.vue",
      code: `${ADAPTER_PROPS}<template>\n  <!-- readable-check: allow optional-call - optional operation: a read-only transcript has no reload -->\n  <div>\n    <button @click="adapter.actions.reload?.()" />\n  </div>\n</template>\n`,
      errors: [{ messageId: "optionalCall", data: { callee: "adapter.actions.reload" }, line: 7 }]
    },
    {
      filename: "Goal.vue",
      code: "<script setup>\ndefineProps({ state: { type: Object, required: true } });\n</script>\n<template><button v-if=\"typeof state.set === 'function'\" /></template>\n",
      errors: [{ messageId: "methodProbe", data: { probe: "state.set" }, line: 4 }]
    }
  ]
});

// One comment above a function excuses the probes in its own body, and only under input validation:.
const NORMALIZE_UPLOAD = "function normalizeUpload(result) {\n  if (typeof result.then === \"function\") return { promise: result };\n  const abort = typeof result.abort === \"function\" ? result.abort : result.cancel;\n  return { promise: result.promise, abort };\n}";
client.run("jskit/required-collaborators (a normalizing function)", requiredCollaborators, {
  valid: [
    `// readable-check: allow method-probe - input validation: an upload returns a promise, { promise, abort } or { promise, cancel }\n${NORMALIZE_UPLOAD}`,
    `// readable-check: allow method-probe - input validation: an upload returns a promise, { promise, abort } or { promise, cancel }\nexport const normalizeUpload = (result) => typeof result.then === "function" ? { promise: result } : result;`
  ],
  invalid: [
    {
      code: `// readable-check: allow method-probe - optional operation: an upload may lack abort\n${NORMALIZE_UPLOAD}`,
      errors: [{ messageId: "methodProbe", line: 3 }, { messageId: "methodProbe", line: 4 }]
    },
    {
      code: "// readable-check: allow method-probe - input validation: an upload returns a promise or { promise, abort }\nfunction normalizeUpload(result) {\n  return () => typeof result.abort === \"function\";\n}",
      errors: [{ messageId: "methodProbe", line: 3 }]
    }
  ]
});

client.run("jskit/no-slot-setter (client)", noSlotSetter, {
  valid: ["export function useDraft() {\n  function setDraft(text) { draft.value = text; }\n  return { setDraft };\n}"],
  invalid: [
    { code: "export function usePlacement() {\n  return { setProvider };\n}", errors: [{ messageId: "setterSeam", data: { setter: "setProvider" } }] }
  ]
});

server.run("jskit/frozen-factory-result (Vue state is never frozen)", frozenFactoryResult, {
  valid: [
    "import { ref } from \"vue\";\nfunction createUploadRuntime() {\n  const progress = ref(0);\n  function start() { progress.value = 1; }\n  return { progress, start };\n}",
    "function useConversation() {\n  function send() {}\n  return { send };\n}"
  ],
  invalid: [
    { code: "function createApi({ request }) {\n  function list() { return request(); }\n  return { list };\n}", errors: [{ messageId: "unfrozenResult" }] }
  ]
});

client.run("jskit/no-factory-spread (client)", noFactorySpread, {
  valid: ["export function useConversation() {\n  const suggestions = useSuggestions();\n  function send() {}\n  return { send, suggestions };\n}"],
  invalid: [
    {
      code: "export function useConversation() {\n  function send() {}\n  return { send, ...useSuggestions() };\n}",
      errors: [{ messageId: "factorySpread", data: { owner: "useConversation", factory: "useSuggestions()" } }]
    }
  ]
});

server.run("jskit/allow-comment-form (shared resource)", allowCommentForm, {
  valid: ["// readable-check: allow module-state - shared resource: the page has one microphone\nlet microphoneOwner = null;"],
  invalid: [{ code: "// readable-check: allow module-state - shared between instances\nlet owner = null;", errors: [{ messageId: "allowPrefix" }] }]
});

components.run("jskit/allow-comment-form (templates)", allowCommentForm, {
  valid: [{ filename: "LoadError.vue", code: `${ADAPTER_PROPS}<template>\n  <!-- readable-check: allow optional-call - optional operation: a read-only transcript has no reload -->\n  <button @click="adapter.actions.reload?.()" />\n</template>\n` }],
  invalid: [
    {
      filename: "LoadError.vue",
      code: `${ADAPTER_PROPS}<template>\n  <!-- readable-check: allow optional-call - reload may be missing -->\n  <button @click="adapter.actions.reload?.()" />\n</template>\n`,
      errors: [{ messageId: "allowPrefix", line: 5, column: 8 }]
    }
  ]
});

// A client helper is compared with the whole package, Vue components and server code included.
const root = mkdtempSync(path.join(tmpdir(), "jskit-client-helper-"));
const HELPER = "function isRecord(value) {\n  return Boolean(value) && typeof value === \"object\" && !Array.isArray(value);\n}\nexport { isRecord };\n";
const LABEL = "function toLabel(value) {\n  return String(value).trim();\n}\n";
function writeSource(relativePath, text) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
writeSource("chat/package.json", "{}\n");
writeSource("chat/src/server/lib/ndjson.js", HELPER);
writeSource("chat/src/client/components/Badge.vue", `<script setup>\n${LABEL}</script>\n<template><b /></template>\n`);
after(() => rmSync(root, { recursive: true, force: true }));
const relative = (file) => path.relative(process.cwd(), file).split(path.sep).join("/");

client.run("jskit/no-duplicate-helper (client)", noDuplicateHelper, {
  valid: [{ code: "function toTitle(value) {\n  return String(value).toUpperCase();\n}\nexport { toTitle };\n", filename: path.join(root, "chat", "src", "client", "title.js") }],
  invalid: [
    {
      code: HELPER,
      filename: path.join(root, "chat", "src", "client", "lib", "api.js"),
      errors: [{ messageId: "clientCopy", data: { name: "isRecord", first: `${relative(path.join(root, "chat", "src", "server", "lib", "ndjson.js"))}:1` } }]
    },
    {
      code: `${LABEL}export { toLabel };\n`,
      filename: path.join(root, "chat", "src", "client", "labels.js"),
      errors: [{ messageId: "duplicateHelper", data: { name: "toLabel", first: `${relative(path.join(root, "chat", "src", "client", "components", "Badge.vue"))}:2` } }]
    }
  ]
});
