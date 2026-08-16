import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("JSKIT skill routes agents directly to package-owned source patterns", async () => {
  const skill = await readFile(path.join(packageRoot, "skills/jskit/SKILL.md"), "utf8");
  const appOperations = await readFile(
    path.join(packageRoot, "skills/jskit/references/app-operations.md"),
    "utf8"
  );
  const patternIndex = await readFile(path.join(packageRoot, "reference/autogen/PATTERN_INDEX.md"), "utf8");
  const referenceIndex = await readFile(path.join(packageRoot, "reference/autogen/README.md"), "utf8");

  assert.match(skill, /Pattern-first implementation/);
  assert.match(skill, /reference\/autogen\/PATTERN_INDEX\.md/);
  assert.match(skill, /Do not write or consult receipts/);
  assert.match(skill, /There is no current JSKIT Doctor command/);
  assert.match(appOperations, /There is no supported `jskit doctor` command/);
  assert.match(appOperations, /Runtime startup owns the capability\/provider graph/);
  assert.doesNotMatch(`${skill}\n${appOperations}`, /scaffoldShape|scaffoldMode|feature-lane|handmade-feature|containerTokens/u);
  assert.match(patternIndex, /crud\/resource-contract/);
  assert.match(patternIndex, /node_modules\/@jskit-ai\/resource-crud-core\/patterns\/resource-contract\/PATTERN\.md/);
  assert.doesNotMatch(
    referenceIndex,
    /jskit-cli|create-app|crud-server-generator|feature-server-generator|crud-ui-generator|ui-generator/u
  );
});
