import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";
import { baseConfig } from "../base.js";

test("baseConfig ignores generated JSKIT runtime and build artifacts", () => {
  const ignoreEntries = baseConfig
    .filter((entry) => Array.isArray(entry?.ignores))
    .flatMap((entry) => entry.ignores);

  assert.deepEqual(
    [
      ".jskit/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "test-results/**"
    ].filter((pattern) => !ignoreEntries.includes(pattern)),
    []
  );
});

test("baseConfig preserves the established lint policy across ESLint 10", () => {
  const sourceRules = baseConfig.find(
    (entry) => Array.isArray(entry?.files) && entry.files.includes("**/*.{js,mjs,cjs,vue}")
  )?.rules;

  assert.equal(sourceRules?.["no-useless-assignment"], "off");
  assert.equal(sourceRules?.["preserve-caught-error"], "off");
});

async function findings(source, filePath = "packages/fleet/src/server/placement.js") {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: baseConfig });
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-use-before-define")
    .map((message) => `${message.line}: ${message.message}`);
}

test("baseConfig refuses a name read before its const, let or class: a local that shadows a helper called a line earlier", async () => {
  // mobilynet's placement: the local byHost shadows the helper, so the call reads the local before it is set and every
  // create threw a ReferenceError.
  const shadowed = [
    "function byHost(machines) {",
    "  return new Map(machines.map((machine) => [machine.host, machine]));",
    "}",
    "export function place(machines, host) {",
    "  const current = byHost(machines).get(host);",
    "  const byHost = current ? [current] : [];",
    "  return byHost;",
    "}",
    ""
  ].join("\n");
  assert.deepEqual(await findings(shadowed), ["5: 'byHost' was used before it was defined."]);
  // The same for a module's const read in the module's own scope before it is declared, and for a class.
  assert.deepEqual(await findings("export const total = rates.length;\nconst rates = [1];\n"),
    ["1: 'rates' was used before it was defined."]);
  assert.deepEqual(await findings("export const shop = new Shop();\nclass Shop {}\n"), ["1: 'Shop' was used before it was defined."]);
  // A function declaration is hoisted, so a call above it is fine; and a function that runs later may read a const
  // declared below it.
  assert.deepEqual(await findings("export const total = sum([1]);\nfunction sum(values) {\n  return values.length;\n}\n"), []);
  assert.deepEqual(await findings("export function total() {\n  return rates.length;\n}\nconst rates = [1];\n"), []);
});
