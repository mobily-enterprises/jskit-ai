import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);
const CLI_ROOT = path.resolve(path.dirname(CLI_PATH), "..");

test("list-placements rejects unsupported value options and prints command help", () => {
  const result = runCli({
    cwd: CLI_ROOT,
    args: ["list-placements", "--prefix", "nope"]
  });

  assert.equal(result.status, 1);
  const stderr = String(result.stderr || "");
  assert.match(stderr, /Unknown option for command list-placements: --prefix\./);
  assert.match(stderr, /Command: list-placements/);
  assert.match(stderr, /jskit list-placements \[--json\]/);
});

test("show rejects unsupported flags and prints command help", () => {
  const result = runCli({
    cwd: CLI_ROOT,
    args: ["show", "auth-web", "--all"]
  });

  assert.equal(result.status, 1);
  const stderr = String(result.stderr || "");
  assert.match(stderr, /Unknown option for command show: --all\./);
  assert.match(stderr, /Command: show/);
  assert.match(stderr, /jskit show <id> \[--details] \[--debug-exports] \[--json]/);
});

test("migrations rejects unsupported flags and prints command help", () => {
  const result = runCli({
    cwd: CLI_ROOT,
    args: ["migrations", "changed", "--run-npm-install"]
  });

  assert.equal(result.status, 1);
  const stderr = String(result.stderr || "");
  assert.match(stderr, /Unknown option for command migrations: --run-npm-install\./);
  assert.match(stderr, /Command: migrations/);
  assert.match(stderr, /jskit migrations <all\|changed\|package> \[packageId] \[--<option> <value>\.\.\.] \[--dry-run] \[--json]/);
  assert.match(stderr, /\[--verbose]/);
});

test("add rejects delegated inline options when no target contract is active", () => {
  const result = runCli({
    cwd: CLI_ROOT,
    args: ["add", "--bogus", "value"]
  });

  assert.equal(result.status, 1);
  const stderr = String(result.stderr || "");
  assert.match(stderr, /Unknown option for command add: --bogus\./);
  assert.match(stderr, /Command: add/);
});

test("generate rejects delegated inline options when no subcommand is active", () => {
  const result = runCli({
    cwd: CLI_ROOT,
    args: ["generate", "ui-generator", "--force"]
  });

  assert.equal(result.status, 1);
  const stderr = String(result.stderr || "");
  assert.match(stderr, /Unknown option for command generate: --force\./);
  assert.match(stderr, /Command: generate/);
});
