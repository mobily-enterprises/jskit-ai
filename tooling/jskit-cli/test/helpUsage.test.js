import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

test("jskit with no args prints top-level command overview", () => {
  const result = runCli({ args: [] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /JSKit CLI/);
  assert.match(stdout, /Available commands:/);
  assert.match(stdout, /generate\s+Run a generator package/);
  assert.match(stdout, /list-placements\s+List discovered UI placement targets/);
  assert.match(stdout, /list-link-items\s+List available placement link-item component tokens/);
});

test("jskit generate with no params lists available generators", () => {
  const result = runCli({ args: ["generate"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generate command/);
  assert.match(stdout, /Available generators \(\d+\):/);
  assert.match(stdout, /@jskit-ai\/crud-server-generator/);
  assert.match(stdout, /jskit generate <generatorId> help/);
});

test("jskit add with no params lists bundles and runtime packages", () => {
  const result = runCli({ args: ["add"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Add command/);
  assert.match(stdout, /Available bundles \(\d+\):/);
  assert.match(stdout, /Available runtime packages \(\d+\):/);
  assert.match(stdout, /jskit add package <packageId> help/);
});

test("jskit help generate prints generate command help", () => {
  const result = runCli({ args: ["help", "generate"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Command: generate/);
  assert.match(stdout, /jskit generate <generatorId>/);
});

test("jskit generate --help prints generate command help", () => {
  const result = runCli({ args: ["generate", "--help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Command: generate/);
  assert.match(stdout, /\[subcommand\]/);
});

test("jskit generate ui-generator outlet help prints outlet-specific usage", () => {
  const result = runCli({ args: ["generate", "ui-generator", "outlet", "help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/ui-generator outlet/);
  assert.match(stdout, /--file/);
  assert.match(stdout, /--host/);
  assert.match(stdout, /--position/);
  assert.match(stdout, /--mode/);
});

test("jskit generate ui-generator outlet with no options prints subcommand help", () => {
  const result = runCli({ args: ["generate", "ui-generator", "outlet"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/ui-generator outlet/);
  assert.match(stdout, /--file/);
  assert.match(stdout, /--host/);
});

test("jskit generate ui-generator page help includes placement token options", () => {
  const result = runCli({ args: ["generate", "ui-generator", "page", "help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/ui-generator page/);
  assert.match(stdout, /--placement-component-token/);
  assert.match(stdout, /--placement-to/);
});

test("jskit help list-link-items prints command help", () => {
  const result = runCli({ args: ["help", "list-link-items"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Command: list-link-items/);
  assert.match(stdout, /jskit list-link-items/);
  assert.match(stdout, /--prefix <value>/);
  assert.match(stdout, /--all/);
});
