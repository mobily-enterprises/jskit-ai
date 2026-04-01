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
