import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { describe, it } from "node:test";
import { ESLint, RuleTester } from "eslint";
import { baseConfig } from "../base.js";
import { playwrightLoginUnchanged } from "../plugin/rules/playwrightLoginUnchanged.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const CONFIG = "playwright.config.mjs";
const OWNERSHIP = "The login state belongs to the host. Pass process.env.PLAYWRIGHT_STORAGE_STATE unchanged to use.storageState. " +
  "If tests run signed out with it, that is a host defect: report it with the evidence; do not work around it.";

// The patch a project made while the host's login was scoped to its Preview proxy: the config reads the supplied
// file, drops the proxy cookie and moves the others to the tested host itself.
const COOKIE_PATCH = [
  "import { readFileSync } from \"node:fs\";",
  "const storageStatePath = String(process.env.PLAYWRIGHT_STORAGE_STATE || \"\").trim();",
  "function storageStateForBaseUrl(path) {",
  "  const state = JSON.parse(readFileSync(path, \"utf8\"));",
  "  return { ...state, cookies: state.cookies.filter((cookie) => !cookie.name.startsWith(\"__Host-\")) };",
  "}",
  "const storageState = storageStatePath ? storageStateForBaseUrl(storageStatePath) : null;",
  "export default { use: { ...(storageState ? { storageState } : {}) } };"
].join("\n");

new RuleTester().run("jskit/playwright-login-unchanged", playwrightLoginUnchanged, {
  valid: [
    // The starters' pass-through.
    {
      filename: CONFIG,
      code: "const storageState = String(process.env.PLAYWRIGHT_STORAGE_STATE || \"\").trim();\n" +
        "export default { use: { ...(storageState ? { storageState } : {}) } };"
    },
    { filename: CONFIG, code: "export default { use: { storageState: process.env.PLAYWRIGHT_STORAGE_STATE || undefined } };" },
    // A per-worker state chosen beside the supplied one still reaches storageState unchanged.
    {
      filename: CONFIG,
      code: "const target = pick();\n" +
        "const storageState = String((target ? target.storageState : process.env.PLAYWRIGHT_STORAGE_STATE) || \"\").trim();\n" +
        "export default { use: { ...(storageState && { storageState }) } };"
    },
    {
      filename: "playwright.local.config.js",
      code: "const { PLAYWRIGHT_STORAGE_STATE: statePath = \"\" } = process.env;\nconst config = { use: {} };\n" +
        "if (statePath) config.use.storageState = statePath;\nexport default config;"
    },
    // Cookies in prose, or in a config that never touches the supplied login, are not its contents.
    {
      filename: CONFIG,
      code: "// The host fits the login's cookies to the tested site.\n" +
        "export default { use: { storageState: process.env.PLAYWRIGHT_STORAGE_STATE } };"
    },
    { filename: CONFIG, code: "export default { use: { storageState: { cookies: [], origins: [] } } };" },
    // Only Playwright configs are checked.
    { filename: "scripts/login.js", code: "const state = JSON.parse(readFileSync(process.env.PLAYWRIGHT_STORAGE_STATE, \"utf8\"));" }
  ],
  invalid: [
    {
      filename: CONFIG,
      code: COOKIE_PATCH,
      errors: [
        { messageId: "changedLogin", line: 5 },
        { messageId: "changedLogin", data: { use: "storageStateForBaseUrl(storageStatePath)" } }
      ]
    },
    {
      filename: CONFIG,
      code: "import fs from \"node:fs\";\nconst statePath = process.env.PLAYWRIGHT_STORAGE_STATE;\n" +
        "export default { use: { storageState: JSON.parse(fs.readFileSync(statePath, \"utf8\")) } };",
      errors: [{ messageId: "changedLogin", data: { use: "fs.readFileSync(statePath, \"utf8\")" } }]
    },
    {
      filename: "playwright.local.config.mjs",
      code: "import { readFile } from \"node:fs/promises\";\n" +
        "const state = JSON.parse(await readFile(process.env[\"PLAYWRIGHT_STORAGE_STATE\"], \"utf8\"));\n" +
        "export default { use: { storageState: state } };",
      errors: [{ messageId: "changedLogin", data: { use: "readFile(process.env[\"PLAYWRIGHT_STORAGE_STATE\"], \"utf8\")" } }]
    },
    {
      filename: CONFIG,
      code: "export default { use: { storageState: process.env.PLAYWRIGHT_STORAGE_STATE || { cookies: [], origins: [] } } };",
      errors: [{ messageId: "changedLogin", data: { use: "cookies: []" } }]
    },
    {
      filename: CONFIG,
      code: "const { PLAYWRIGHT_STORAGE_STATE } = process.env;\nexport default { use: { storageState: fitToHost(PLAYWRIGHT_STORAGE_STATE) } };",
      errors: [{ messageId: "changedLogin", data: { use: "fitToHost(PLAYWRIGHT_STORAGE_STATE)" } }]
    }
  ]
});

test("the finding gives the host's own refusal sentences and is an error in every JSKIT app's config", async () => {
  assert.ok(playwrightLoginUnchanged.meta.messages.changedLogin.includes(OWNERSHIP));
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: baseConfig });
  const findings = async (code, filePath) => (await eslint.lintText(code, { filePath }))[0].messages
    .filter((message) => message.ruleId === "jskit/playwright-login-unchanged")
    .map((message) => message.severity);
  assert.deepEqual(await findings(COOKIE_PATCH, CONFIG), [2, 2]);
  assert.deepEqual(await findings(COOKIE_PATCH, "playwright.local.config.mjs"), [2, 2]);
  assert.deepEqual(await findings(COOKIE_PATCH, "src/login.js"), []);
});

test("JSKIT's own example Playwright configs pass their login on unchanged", async () => {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: baseConfig });
  for (const example of [
    "packages/agent-docs/patterns/minimal-foundation/example/playwright.config.mjs",
    "packages/agent-docs/patterns/shell-foundation/example/playwright.config.mjs",
    "packages/agent-docs/skills/jskit/references/patterns/app/minimal-foundation/example/playwright.config.mjs",
    "packages/agent-docs/skills/jskit/references/patterns/app/shell-foundation/example/playwright.config.mjs",
    "packages/connectors-web/test/playwright.config.js"
  ]) {
    const code = await readFile(new URL(`../../../${example}`, import.meta.url), "utf8");
    assert.match(code, /process\.env\.PLAYWRIGHT_STORAGE_STATE/u, `${example} reads the supplied login`);
    const [result] = await eslint.lintText(code, { filePath: "playwright.config.mjs" });
    assert.deepEqual(result.messages.filter((message) => message.ruleId === "jskit/playwright-login-unchanged"), [], example);
  }
});
