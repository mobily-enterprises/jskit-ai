import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertUniquePatternIds,
  discoverPackagePatterns,
  parsePatternDocument
} from "../scripts/pattern-assets.mjs";

const COMPLETE_PATTERN = `---
id: example/use-command
title: Use a command
summary: Demonstrate a normal command operation.
keywords: command, http
requires: @jskit-ai/http-web
---

# Use a command

## Use when
Use it.

## Do not use when
Do not use it for reads.

## Product decisions
Know the operation.

## Invariants
Keep one submission active.

## Framework APIs
Use the public command API.

## Example files
Copy the example.

## Variation points
Change product copy.

## Verification
Run a focused test.

## Avoid
Do not create a request helper.
`;

test("pattern documents are readable Markdown with strict minimal metadata", () => {
  assert.deepEqual(parsePatternDocument(COMPLETE_PATTERN), {
    id: "example/use-command",
    title: "Use a command",
    summary: "Demonstrate a normal command operation.",
    keywords: ["command", "http"],
    requires: ["@jskit-ai/http-web"]
  });
});

test("pattern documents reject missing agent-facing contract sections", () => {
  assert.throws(
    () => parsePatternDocument(COMPLETE_PATTERN.replace("## Verification", "## Checks")),
    /missing required section\(s\): Verification/
  );
});

test("package pattern discovery requires real example files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-pattern-"));
  try {
    const patternRoot = path.join(tempRoot, "patterns", "use-command");
    await mkdir(path.join(patternRoot, "example"), { recursive: true });
    await writeFile(path.join(patternRoot, "PATTERN.md"), COMPLETE_PATTERN, "utf8");
    await writeFile(path.join(patternRoot, "example", "command.js"), "export const command = true;\n", "utf8");

    const patterns = await discoverPackagePatterns({
      packageRoot: tempRoot,
      packageJson: {
        name: "@jskit-ai/example",
        version: "0.1.0"
      }
    });

    assert.deepEqual(patterns, [
      {
        id: "example/use-command",
        title: "Use a command",
        summary: "Demonstrate a normal command operation.",
        keywords: ["command", "http"],
        requires: ["@jskit-ai/http-web"],
        packageId: "@jskit-ai/example",
        packageVersion: "0.1.0",
        documentPath: "patterns/use-command/PATTERN.md",
        examplePath: "patterns/use-command/example",
        files: ["command.js"]
      }
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pattern ids are globally unique", () => {
  assert.throws(
    () => assertUniquePatternIds([
      { id: "crud/resource", packageId: "@jskit-ai/a" },
      { id: "crud/resource", packageId: "@jskit-ai/b" }
    ]),
    /Duplicate JSKIT pattern id/
  );
});
