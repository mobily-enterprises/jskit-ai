import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";
import { baseConfig } from "../base.js";
import { clientFeaturesConfig } from "../clientFeatures.js";
import { jskitPlugin } from "../plugin/index.js";
import { typedFeaturesConfig } from "../typedFeatures.js";
import { vueConfig } from "../vue.js";

const COMPOSABLE = [
  "import { inject } from \"vue\";",
  "let lastDraft = \"\";",
  "export function useDraft({ store } = {}) {",
  "  const theme = inject(\"theme\");",
  "  return { save: () => store.save?.(lastDraft, theme) };",
  "}",
  ""
].join("\n");
const COMPONENT = [
  "<script setup>",
  "defineProps({ adapter: Object });",
  "</script>",
  "<template><button @click=\"adapter.resend(); $emit('sent')\" /></template>",
  ""
].join("\n");
const CLIENT_ONLY_RULES = Object.freeze(["typed-inject", "collaborator-props", "fixed-result-shape", "released-listeners", "no-module-state", "no-frozen-vue-state", "selection-field", "search-on-server"]);
const SERVER_ONLY_RULES = Object.freeze(["one-line-action", "action-execute-shape", "action-creator", "no-idempotency", "app-error-code", "no-patched-error", "narrow-in-query"]);
// The rule baseConfig holds every application's Playwright configs to, outside the client features.
const BASE_ONLY_RULES = Object.freeze(["playwright-login-unchanged"]);
// The data-access rules, which dataAccessConfig and baseConfig turn on for server and shared code.
const DATA_ACCESS_RULES = Object.freeze(["no-direct-knex", "no-transaction-reader", "sql-literal", "no-hand-scope", "no-hand-context", "knex-reason"]);
const COMPONENT_RULES = Object.freeze(["vue/require-prop-types", "vue/require-default-prop", "vue/require-valid-default-prop", "vue/no-required-prop-with-default", "vue/require-explicit-emits"]);

// Each rule that reports on a file, once, with its severity.
async function findings(config, text, filePath) {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
  const [result] = await eslint.lintText(text, { filePath });
  const fatal = result.messages.find((message) => message.fatal);
  assert.equal(fatal, undefined, fatal?.message);
  return [...new Set(result.messages
    .filter((message) => message.ruleId?.startsWith("jskit/") || COMPONENT_RULES.includes(message.ruleId))
    .map((message) => `${message.severity === 2 ? "error" : "warn"} ${message.ruleId}`))].sort();
}

const APPLICATION = Object.freeze([...baseConfig, ...vueConfig, ...typedFeaturesConfig(["packages/booking/src/server/**"])]);

test("clientFeaturesConfig makes the client rules errors for the client trees an application lists", async () => {
  const config = [...APPLICATION, ...clientFeaturesConfig(["packages/booking/src/client/**"])];
  assert.deepEqual(await findings(config, COMPOSABLE, "packages/booking/src/client/composables/useDraft.js"), [
    "error jskit/no-module-state",
    "error jskit/required-collaborators",
    "error jskit/typed-dependencies",
    "error jskit/typed-inject"
  ]);
  assert.deepEqual(await findings(config, COMPONENT, "packages/booking/src/client/components/Resend.vue"), [
    "error jskit/collaborator-props",
    "error vue/require-default-prop",
    "error vue/require-explicit-emits"
  ]);
  assert.deepEqual(await findings(config, COMPOSABLE, "packages/booking/src/client/test/useDraft.js"), []);
  assert.deepEqual(await findings(config, COMPOSABLE, "packages/booking/src/client/useDraft.test.js"), []);
});

test("an application's client code gets no client rule until it lists the tree", async () => {
  const config = [...APPLICATION, ...clientFeaturesConfig(["packages/booking/src/client/**"])];
  for (const preset of [APPLICATION, config]) {
    assert.deepEqual(await findings(preset, COMPOSABLE, "packages/invoices/src/client/composables/useDraft.js"), []);
    assert.deepEqual(await findings(preset, COMPONENT, "packages/invoices/src/client/components/Resend.vue"), [
      "warn vue/require-default-prop",
      "warn vue/require-explicit-emits"
    ]);
  }
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: APPLICATION });
  for (const filePath of ["packages/booking/src/client/useDraft.js", "packages/booking/src/client/Resend.vue", "packages/booking/src/server/reader.js"]) {
    const { rules, settings } = await eslint.calculateConfigForFile(filePath);
    assert.deepEqual(CLIENT_ONLY_RULES.filter((rule) => rules[`jskit/${rule}`]), [], filePath);
    assert.equal(settings?.jskit?.client, undefined, filePath);
  }
});

test("clientFeaturesConfig turns on every jskit rule but the server's action and error rules", () => {
  const [entry, components] = clientFeaturesConfig(["src/client/**"]);
  const notClient = [...SERVER_ONLY_RULES, ...BASE_ONLY_RULES, ...DATA_ACCESS_RULES];
  assert.deepEqual(Object.keys(jskitPlugin.rules).filter((rule) => !notClient.includes(rule) && entry.rules[`jskit/${rule}`] !== "error"), []);
  assert.deepEqual(notClient.filter((rule) => entry.rules[`jskit/${rule}`]), []);
  assert.deepEqual(entry.settings, { jskit: { client: true } });
  assert.deepEqual(entry.rules["max-lines"], ["error", { max: 750 }]);
  assert.deepEqual(Object.keys(components.rules), COMPONENT_RULES);
  assert.equal(clientFeaturesConfig(["src/client/**"], "warn")[0].rules["jskit/typed-inject"], "warn");
  assert.throws(() => clientFeaturesConfig([]), TypeError);
});
