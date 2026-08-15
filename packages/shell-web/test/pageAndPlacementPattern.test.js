import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse as parseSfc } from "@vue/compiler-sfc";

const patternRoot = new URL("../patterns/page-and-placement/example/", import.meta.url);
const vueFiles = [
  "src/pages/home/reports.vue",
  "src/pages/home/reports/index.vue",
  "src/pages/home/reports/overview.vue",
  "src/pages/home/reports/activity.vue",
  "src/components/SyncStatusElement.vue"
];
const jsFiles = [
  "src/placement.js",
  "src/placementTopology.js",
  "packages/main/src/client/providers/MainClientProvider.js"
];

test("page and placement pattern is executable, semantic application source", async () => {
  const sources = [];
  for (const relativePath of vueFiles) {
    const source = await readFile(new URL(relativePath, patternRoot), "utf8");
    sources.push(source);
    const parsed = parseSfc(source, { filename: relativePath });
    assert.equal(parsed.errors.length, 0, `${relativePath}: ${parsed.errors.join("\n")}`);
  }
  for (const relativePath of jsFiles) {
    const source = await readFile(new URL(relativePath, patternRoot), "utf8");
    sources.push(source);
    assert.match(source, /(?:export|addPlacement|registerMainClientComponent)/u, relativePath);
  }

  const combined = sources.join("\n");
  assert.match(combined, /createPlacementRegistry|addPlacementTopology|ShellOutlet/u);
  assert.doesNotMatch(combined, /ui-generator|generated-ui|scaffold|receipt|provenance/u);
  assert.doesNotMatch(combined, /replace this|ready for your/u);
});
