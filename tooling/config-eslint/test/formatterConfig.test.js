import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";
import { formatterConfig } from "../formatter.js";

const FILE = "packages/billing/src/server/invoices.js";

async function findings(source, filePath = FILE) {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: formatterConfig(["packages/*/src/server/**"]) });
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.map((message) => message.ruleId);
}

test("formatterConfig allows a one-line if and refuses three statements on one line", async () => {
  assert.deepEqual(await findings("function read(x, y) {\n  if (x) return y;\n  return null;\n}\nread(1, 2);\n"), []);
  assert.deepEqual(await findings("a(); b();\n"), []);
  assert.deepEqual(await findings("a(); b(); c();\n"), ["max-statements-per-line"]);
});

test("formatterConfig enforces semicolons, double quotes and no trailing commas", async () => {
  assert.deepEqual(await findings("const a = 'x'\n"), ["quotes", "semi"]);
  assert.deepEqual(await findings("const a = [\n  1,\n  2,\n];\n"), ["comma-dangle"]);
  assert.deepEqual(await findings("const a = \"it's\";\nconst b = `x${a}`;\n"), []);
});

test("formatterConfig wraps code at 140 characters and leaves long strings and type tags inline", async () => {
  const longCall = `run(${"argument, ".repeat(14)}last);\n`;
  assert.deepEqual(await findings(longCall), ["max-len"]);
  assert.deepEqual(await findings(`const message = "${"word ".repeat(40)}";\n`), []);
  assert.deepEqual(await findings(`/** @param {{ ${"field: string, ".repeat(10)}last: string }} input */\nfunction read(input) { return input; }\nread({});\n`), []);
});

test("formatterConfig puts each property on its own line once the properties span lines", async () => {
  assert.deepEqual(await findings("const a = { b: 1, c: 2 };\n"), []);
  assert.deepEqual(await findings("const a = {\n  b: 1, c: 2,\n  d: 3\n};\n"), ["object-property-newline"]);
  assert.deepEqual(await findings("const a = { b: 1,\n  c: 2 };\n"), ["object-curly-newline", "object-curly-newline"]);
});

test("formatterConfig leaves tests and the ignored files alone", async () => {
  assert.deepEqual(await findings("const a = 'x'\n", "packages/billing/test/invoices.test.js"), []);
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: formatterConfig(["packages/*/src/server/**"], { ignores: ["packages/billing/src/server/upgrades/**"] })
  });
  const [result] = await eslint.lintText("const a = 'x'\n", { filePath: "packages/billing/src/server/upgrades/one.js", warnIgnored: false });
  assert.equal(result?.messages.length ?? 0, 0);
  assert.throws(() => formatterConfig([]), TypeError);
});
