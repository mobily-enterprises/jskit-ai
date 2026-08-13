import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the single JSKIT skill covers implementation and review without removed workflow docs", async () => {
  const skillRoot = path.join(packageRoot, "skills/jskit");
  const referencesRoot = path.join(skillRoot, "references");
  const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const referenceFiles = (await readdir(referencesRoot)).sort();
  const references = await Promise.all(referenceFiles.map(async (file) => ({
    file,
    source: await readFile(path.join(referencesRoot, file), "utf8"),
  })));
  const operationalSource = [skill, ...references.map(({ source }) => source)].join("\n");

  assert.deepEqual(referenceFiles, [
    "app-operations.md",
    "crud-operations.md",
    "ui-operations.md",
  ]);
  for (const file of referenceFiles) {
    assert.match(skill, new RegExp(`\\(references/${file.replace(".", "\\.")}\\)`, "u"));
  }
  const localLinks = [...skill.matchAll(/\[[^\]\n]*\]\(([^)]+)\)/gu)]
    .map((match) => match[1]);
  assert.deepEqual(localLinks.sort(), referenceFiles.map((file) => `references/${file}`).sort());
  assert.equal(references.every(({ source }) => !/\[[^\]\n]*\]\((?!https?:|mailto:|#)[^)]+\)/u.test(source)), true);

  assert.match(operationalSource, /current diff/);
  assert.match(operationalSource, /@jskit-ai\/create-app/u);
  assert.match(operationalSource, /npx --no-install jskit add package/u);
  assert.match(operationalSource, /Conventional one-table CRUD/u);
  assert.match(operationalSource, /crud-server-generator scaffold/u);
  assert.match(operationalSource, /crud-ui-generator crud/u);
  assert.match(operationalSource, /target is relative to `src\/pages\/`, starts with the selected surface's\s+nonempty configured `pagesRoot`/u);
  assert.match(operationalSource, /for example\s+`home\/books`/u);
  assert.match(operationalSource, /surface deliberately configured with an empty root, use\s+only the plural route/u);
  assert.match(operationalSource, /exact singular\s+resource\s+filename emitted by the server generator/u);
  assert.match(skill, /Caller-owned verification/u);
  assert.match(skill, /Do not start a dev server/u);
  assert.match(skill, /Review or deslop/u);
  assert.match(skill, /complete operational references required by this skill/u);
  assert.match(skill, /Do not load\s+irrelevant references/u);
  assert.match(skill, /complete exact JSKIT command lane with all option\s+values directly/u);
  assert.match(skill, /skip `help`, `list`, `show --details`, `list-placements`, sibling docs,\s+`node_modules` or generator-source inspection, plus any verification the\s+caller owns/u);
  assert.match(skill, /Discover only a missing fact or exact-command failure/u);
  const crudReference = references.find(({ file }) => file === "crud-operations.md").source;
  const uiReference = references.find(({ file }) => file === "ui-operations.md").source;
  assert.match(
    crudReference,
    /Inspect only a generator whose exact\s+lane or option values are\s+missing, or whose supplied command failed/u
  );
  assert.match(crudReference, /Never run these merely to reconfirm caller-supplied facts/u);
  assert.match(uiReference, /custom sibling\/child links,\s+resolve current dynamic params with their runtime to an absolute URL\/route\s+object/u);
  assert.match(uiReference, /never bind its route-template\/relative string raw to Vue Router `to`/u);
  assert.doesNotMatch(operationalSource, /<agent-docs>|node_modules\/@jskit-ai\/agent-docs/u);
  assert.doesNotMatch(operationalSource, /(?:^|[\s`(])\.\.\//mu);
  assert.doesNotMatch(operationalSource, /(?:^|[\s`(])(?:patterns|guide\/agent|site\/guide)\//mu);
  assert.doesNotMatch(operationalSource, /Genesis|Program module|module bound/u);
  assert.ok(Buffer.byteLength(operationalSource) <= 14 * 1024);
});

test("UI testing guidance uses private local exchange support and managed storage state", async () => {
  const pattern = await readFile(path.join(packageRoot, "patterns/ui-testing.md"), "utf8");
  const humanGuide = await readFile(path.join(packageRoot, "site/guide/app-setup/authentication.md"), "utf8");
  const distributedGuide = await readFile(path.join(packageRoot, "guide/agent/app-setup/authentication.md"), "utf8");

  for (const source of [pattern, humanGuide, distributedGuide]) {
    assert.match(source, /@jskit-ai\/auth-web\/test\/playwright/u);
    assert.match(source, /x-jskit-dev-auth-secret/u);
    assert.match(source, /VIBE64_PLAYWRIGHT_STORAGE_STATE/u);
    assert.doesNotMatch(source, /page\.evaluate\(async/u);
    assert.doesNotMatch(source, /fetch\("\/api\/dev-auth\/login-as"/u);
  }
});

test("managed app-owned tests are customizable but not disposable", async () => {
  const relativePaths = [
    "patterns/ui-testing.md",
    "site/guide/app-setup/working-with-the-jskit-cli.md",
    "skills/jskit/references/ui-operations.md"
  ];
  const sources = await Promise.all(
    relativePaths.map((relativePath) => readFile(path.join(packageRoot, relativePath), "utf8"))
  );

  for (const source of sources) {
    assert.match(source, /App-owned.*customizable|“App-owned”.*customizable/is);
    assert.match(source, /Never delete or rename.*\.jskit\/lock\.json/is);
    assert.match(source, /adapt.*in place/is);
    assert.match(source, /canonical route/is);
    assert.match(source, /Doctor.*missing/is);
  }

  assert.match(sources[0], /tests\/e2e\/base-shell\.spec\.ts/);
  assert.match(sources[0], /tests\/e2e\/adaptive-shell\.spec\.ts/);
});

test("adaptive drawer guidance documents Vuetify rail and compact close behavior", async () => {
  const humanGuide = await readFile(
    path.join(packageRoot, "site/guide/app-setup/a-more-interesting-shell.md"),
    "utf8"
  );
  const skillReference = await readFile(
    path.join(packageRoot, "skills/jskit/references/ui-operations.md"),
    "utf8"
  );

  for (const source of [humanGuide, skillReference]) {
    assert.match(source, /Vuetify/);
    assert.match(source, /compact.*close|compact\/mobile.*closes/is);
    assert.match(source, /desktopDrawerClosedMode|desktop-drawer-closed-mode/);
    assert.match(source, /drawerWidth|drawer-width/);
    assert.match(source, /railWidth|rail-width/);
    assert.match(source, /10 CSS pixels|10px/);
    assert.match(source, /rail/);
    assert.match(source, /hidden/);
  }
});
