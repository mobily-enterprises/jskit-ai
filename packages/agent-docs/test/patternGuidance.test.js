import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function indexedTargets(source = "") {
  return [...String(source).matchAll(
    /^- (?:Read|Examples): \[[^\]]+\]\(([^)]+)\)$/gmu
  )].map((match) => match[1]);
}

async function assertIndexedTargetsExist(indexPath) {
  const source = await readFile(indexPath, "utf8");
  const targets = indexedTargets(source);
  assert.ok(targets.length > 0);
  assert.equal(targets.length % 2, 0);
  for (const target of targets) {
    await access(path.resolve(path.dirname(indexPath), decodeURIComponent(target)));
  }
  return source;
}

test("JSKIT documentation publishes complete pattern pages and self-contained indexes", async () => {
  const skill = await readFile(path.join(packageRoot, "skills/jskit/SKILL.md"), "utf8");
  const appOperations = await readFile(
    path.join(packageRoot, "skills/jskit/references/app-operations.md"),
    "utf8"
  );
  const patternIndex = await assertIndexedTargetsExist(
    path.join(packageRoot, "reference/autogen/PATTERN_INDEX.md")
  );
  const skillPatternIndex = await assertIndexedTargetsExist(
    path.join(packageRoot, "skills/jskit/references/pattern-index.md")
  );
  const publicPatternIndex = await readFile(
    path.join(packageRoot, "site/patterns/index.md"),
    "utf8"
  );
  const publicCrudPattern = await readFile(
    path.join(packageRoot, "site/patterns/crud/resource-contract.md"),
    "utf8"
  );
  const referenceIndex = await readFile(path.join(packageRoot, "reference/autogen/README.md"), "utf8");

  assert.match(skill, /Pattern-first implementation/);
  assert.match(skill, /references\/pattern-index\.md/);
  assert.match(skill, /do not install a runtime package merely to read them/u);
  assert.match(skill, /Do not write or consult receipts/);
  assert.match(skill, /There is no current JSKIT Doctor command/);
  assert.match(appOperations, /There is no supported `jskit doctor` command/);
  assert.match(appOperations, /Runtime startup owns the capability\/provider graph/);
  assert.match(appOperations, /bundled source pattern index/u);
  assert.doesNotMatch(`${skill}\n${appOperations}`, /scaffoldShape|scaffoldMode|feature-lane|handmade-feature|containerTokens/u);

  for (const index of [patternIndex, skillPatternIndex]) {
    assert.match(index, /crud\/resource-contract/);
    assert.doesNotMatch(index, /node_modules\/@jskit-ai\//u);
  }
  assert.match(patternIndex, /\.\.\/\.\.\/skills\/jskit\/references\/patterns\/crud\/resource-contract\/PATTERN\.md/u);
  assert.match(skillPatternIndex, /patterns\/crud\/resource-contract\/PATTERN\.md/u);
  assert.match(publicPatternIndex, /\[Owner-scoped CRUD resource contract\]\(\/patterns\/crud\/resource-contract\)/u);
  assert.match(publicCrudPattern, /# Owner-scoped CRUD resource contract/u);
  assert.match(publicCrudPattern, /Browse the complete example tree/u);
  assert.doesNotMatch(
    referenceIndex,
    /jskit-cli|create-app|crud-server-generator|feature-server-generator|crud-ui-generator|ui-generator/u
  );
});

test("a clean install of the packed agent-docs package has no dangling indexed paths", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-agent-docs-package-"));
  const packRoot = path.join(temporaryRoot, "pack");
  const fixtureRoot = path.join(temporaryRoot, "fixture");
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(packRoot, { recursive: true });
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify({ name: "agent-docs-clean-install", private: true }, null, 2)}\n`,
    "utf8"
  );

  const packed = await execFileAsync("npm", [
    "pack",
    "--json",
    "--pack-destination",
    packRoot,
  ], { cwd: packageRoot });
  const [{ filename }] = JSON.parse(packed.stdout);
  await execFileAsync("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    path.join(packRoot, filename),
  ], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      npm_config_cache: path.join(temporaryRoot, "npm-cache"),
    },
  });

  const installedRoot = path.join(fixtureRoot, "node_modules/@jskit-ai/agent-docs");
  assert.deepEqual(
    (await readdir(path.join(fixtureRoot, "node_modules/@jskit-ai"))).sort(),
    ["agent-docs"]
  );
  await assertIndexedTargetsExist(path.join(installedRoot, "reference/autogen/PATTERN_INDEX.md"));
  await assertIndexedTargetsExist(path.join(installedRoot, "skills/jskit/references/pattern-index.md"));
});
