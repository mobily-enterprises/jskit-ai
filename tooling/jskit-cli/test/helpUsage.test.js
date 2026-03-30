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

test("jskit generate with no params prints generate command help", () => {
  const result = runCli({ args: ["generate"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Command: generate/);
  assert.match(stdout, /1\) Minimal use/);
  assert.match(stdout, /2\) Defaults/);
  assert.match(stdout, /3\) Full use/);
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
