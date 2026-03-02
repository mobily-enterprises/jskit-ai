import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const POLICY_PATH = path.resolve("docs/framework/NO_LEGACY_POLICY.md");
const ALLOWLIST_PATH = path.resolve("tests/framework/no-legacy.allowlist.json");

const SCAN_PATHS = Object.freeze([
  path.resolve("packages/tooling/jskit/src"),
  path.resolve("packages/tooling/create-app/src"),
  path.resolve("packages/tooling/create-app/templates/base-shell"),
  path.resolve("apps/base-app")
]);

const REQUIRED_POLICY_HEADINGS = Object.freeze([
  "## Scope",
  "## Banned Legacy Surfaces",
  "## Enforcement",
  "## Breaking Changes",
  "## Migration Path from Pre-Cut Apps"
]);

const BANNED_RULES = Object.freeze([
  {
    id: "legacy-manifest-path",
    pattern: "framework/app\\.manifest\\.mjs",
    explanation: "Legacy app manifest path must be fully removed from runtime scaffolding."
  },
  {
    id: "legacy-optional-module-packs-key",
    pattern: "\\boptionalModulePacks\\b",
    explanation: "Legacy optional module pack composition key is disallowed."
  },
  {
    id: "legacy-profile-id-key",
    pattern: "\\bprofileId\\b",
    explanation: "Legacy profileId runtime composition key is disallowed."
  },
  {
    id: "legacy-enforce-profile-required-key",
    pattern: "\\benforceProfileRequired\\b",
    explanation: "Legacy enforceProfileRequired runtime composition key is disallowed."
  }
]);

function runRuleScan(rule) {
  const result = spawnSync(
    "rg",
    [
      "--line-number",
      "--with-filename",
      "--pcre2",
      "--glob",
      "!**/tests/**",
      "--glob",
      "!**/*.test.*",
      rule.pattern,
      ...SCAN_PATHS
    ],
    {
      cwd: path.resolve("."),
      encoding: "utf8"
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status === 1) {
    return [];
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `rg failed for rule ${rule.id}`);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

test("no-legacy policy doc keeps required sections", async () => {
  const content = await readFile(POLICY_PATH, "utf8");
  for (const heading of REQUIRED_POLICY_HEADINGS) {
    assert(content.includes(heading), `Missing policy heading: ${heading}`);
  }
});

test("no-legacy allowlist is empty at final cutover", async () => {
  const source = await readFile(ALLOWLIST_PATH, "utf8");
  const allowlist = JSON.parse(source);
  assert.deepEqual(allowlist, []);
});

test("active framework codepaths contain no banned legacy surfaces", () => {
  const failures = [];

  for (const rule of BANNED_RULES) {
    const matches = runRuleScan(rule);
    if (matches.length > 0) {
      failures.push({
        rule: rule.id,
        explanation: rule.explanation,
        matches
      });
    }
  }

  assert.deepEqual(
    failures,
    [],
    `Legacy surface matches detected:\n${JSON.stringify(failures, null, 2)}`
  );
});
