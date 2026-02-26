import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const DECISIONS_PATH = path.resolve("docs/framework/DECISIONS.md");

const requiredHeadings = [
  "## Non-negotiables",
  "## Scope Snapshot",
  "## End-State Architecture",
  "## Data Contract Freeze",
  "## CLI Contract"
];

const requiredNonNegotiables = [
  "Package-owned behavior only",
  "Bundles never contain app-mutation logic",
  "No silent fallback behavior",
  "No legacy compatibility shims",
  "All writes are rollback-safe",
  "Capability requirements must be enforced both at mutation time and via `jskit doctor`",
  "Package IDs must remain npm-compatible",
  "All destructive operations must be explainable and dry-runnable"
];

test("decision guard keeps the critical headings", async () => {
  const content = await readFile(DECISIONS_PATH, "utf8");
  for (const heading of requiredHeadings) {
    assert(content.includes(heading), `Missing heading ${heading}`);
  }
});

test("decision guard documents the non-negotiables", async () => {
  const content = await readFile(DECISIONS_PATH, "utf8");
  for (const clause of requiredNonNegotiables) {
    assert(content.includes(clause), `Missing non-negotiable clause: ${clause}`);
  }
});
