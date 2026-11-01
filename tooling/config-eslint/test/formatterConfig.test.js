import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";
import { formatterConfig } from "../formatter.js";

const FILE = "packages/billing/src/server/invoices.js";

async function fixed(source) {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: formatterConfig(["packages/*/src/server/**"]), fix: true });
  const [result] = await eslint.lintText(source, { filePath: FILE });
  return { output: result.output ?? source, remaining: result.messages.map((message) => message.ruleId) };
}

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
  assert.deepEqual(await findings(`/** @param {{ ${"field: string, ".repeat(10)}last: string }} input */\nfunction read(input) {\n  return input;\n}\nread({});\n`), []);
});

test("formatterConfig puts each property on its own line once the properties span lines", async () => {
  assert.deepEqual(await findings("const a = { b: 1, c: 2 };\n"), []);
  assert.deepEqual(await findings("const a = {\n  b: 1, c: 2,\n  d: 3\n};\n"), ["object-property-newline"]);
  assert.deepEqual(await findings("const a = { b: 1,\n  c: 2 };\n"), ["object-curly-newline", "object-curly-newline"]);
});

test("formatterConfig keeps a braced block on its own lines, indented by two spaces", async () => {
  assert.deepEqual(await findings("function read(x) { return x; }\nread(1);\n"), ["brace-style", "brace-style"]);
  assert.deepEqual(await findings("function read(x) {\n  if (x) {\n    return 1;\n  }\n  else {\n    return 2;\n  }\n}\nread(1);\n"), ["brace-style"]);
  assert.deepEqual(await findings("function read(x) {\n    return x;\n}\nread(1);\n"), ["indent"]);
  assert.deepEqual(await findings("function pick(x) {\n  return x\n    ? {\n        ...x,\n        on: true\n      }\n    : null;\n}\npick({});\n"), []);
  assert.deepEqual(await findings("function size(x) {\n  switch (x) {\n    case 1:\n      return \"one\";\n    default:\n      return \"many\";\n  }\n}\nsize(1);\n"), []);
});

test("formatterConfig's autofix output is formatted: braced blocks and broken calls are re-indented", async () => {
  const source = [
    "function check(value) {",
    "  if (value) return 1;",
    "  else {",
    "    log(value);",
    "    return 2;",
    "  }",
    "}",
    "",
    "function run(value) {",
    "  if (value)",
    "    start(value,",
    "      value);",
    "  return { value,",
    "    active: true };",
    "}",
    "",
    "function message(name) {",
    "  return format(`Hello ${name}`,",
    "    name);",
    "}",
    "",
    "function describe(name) {",
    "  switch (name) {",
    "  case \"a\":",
    "    return 1;",
    "  default:",
    "    return 2;",
    "  }",
    "}",
    "",
    "export { check, describe, message, run };",
    ""
  ].join("\n");
  const expected = [
    "function check(value) {",
    "  if (value) {",
    "    return 1;",
    "  } else {",
    "    log(value);",
    "    return 2;",
    "  }",
    "}",
    "",
    "function run(value) {",
    "  if (value) {",
    "    start(",
    "      value,",
    "      value",
    "    );",
    "  }",
    "  return {",
    "    value,",
    "    active: true",
    "  };",
    "}",
    "",
    "function message(name) {",
    "  return format(",
    "    `Hello ${name}`,",
    "    name",
    "  );",
    "}",
    "",
    "function describe(name) {",
    "  switch (name) {",
    "    case \"a\":",
    "      return 1;",
    "    default:",
    "      return 2;",
    "  }",
    "}",
    "",
    "export { check, describe, message, run };",
    ""
  ].join("\n");

  const { output, remaining } = await fixed(source);

  assert.equal(output, expected);
  assert.deepEqual(remaining, []);
  assert.deepEqual(await fixed(expected), { output: expected, remaining: [] });
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
