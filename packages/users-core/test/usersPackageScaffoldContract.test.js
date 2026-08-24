import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patternRoot = path.join(packageRoot, "patterns", "user-administration-server");

test("users-core publishes agent-readable administration patterns and package-owned migrations", async () => {
  assert.equal(packageJson.jskit?.mutations, undefined);
  assert.deepEqual(packageJson.jskit?.migrations, { directories: ["migrations"] });

  const pattern = await readFile(path.join(patternRoot, "PATTERN.md"), "utf8");
  assert.match(pattern, /defineCrudJsonApiFeature\(\)/);
  assert.match(pattern, /Workspace operations are scoped before repository access/);
  assert.match(pattern, /null\/cleared fields/);
  assert.doesNotMatch(pattern, /createCrudJsonApiModule/);
});

test("global user administration example is one declarative CRUD feature", async () => {
  const packageManifest = JSON.parse(await readFile(
    path.join(patternRoot, "example", "packages", "users", "package.json"),
    "utf8"
  ));
  const feature = await readFile(
    path.join(patternRoot, "example", "packages", "users", "src", "server", "UsersFeature.js"),
    "utf8"
  );

  assert.equal(packageManifest.name, "@app/users");
  assert.equal(packageManifest.jskit?.mutations, undefined);
  assert.deepEqual(packageManifest.jskit?.capabilities?.provides, ["app.users"]);
  assert.match(feature, /defineCrudJsonApiFeature/);
  assert.match(feature, /surface: "home"/);
  assert.match(feature, /ownershipFilter: "public"/);
  assert.doesNotMatch(feature, /\.make\(|\.singleton\(|containerToken|repositoryToken|serviceToken/);
});

test("workspace user administration example makes route and action scope explicit", async () => {
  const packageManifest = JSON.parse(await readFile(
    path.join(patternRoot, "example", "packages", "users-workspace", "package.json"),
    "utf8"
  ));
  const feature = await readFile(
    path.join(
      patternRoot,
      "example",
      "packages",
      "users-workspace",
      "src",
      "server",
      "UsersWorkspaceFeature.js"
    ),
    "utf8"
  );

  assert.equal(packageManifest.name, "@app/users-workspace");
  assert.equal(packageManifest.jskit?.mutations, undefined);
  assert.deepEqual(packageManifest.jskit?.capabilities?.provides, ["app.users-workspace"]);
  assert.match(feature, /ownershipFilter: "workspace"/);
  assert.match(feature, /routeBase: "\/w\/:workspaceSlug"/);
  assert.match(feature, /actionInputValidator: workspaceSlugParamsValidator/);
  assert.match(feature, /inputKeys: \["workspaceSlug"\]/);
  assert.match(feature, /buildWorkspaceInputFromRouteParams/);
  assert.doesNotMatch(feature, /\.make\(|\.singleton\(|containerToken|repositoryToken|serviceToken/);
});

test("both user administration variants stay read-only and canonical", async () => {
  for (const packageName of ["users", "users-workspace"]) {
    const resourceModule = await import(pathToFileURL(
      path.join(patternRoot, "example", "packages", packageName, "src", "shared", "userResource.js")
    ).href);
    const resource = resourceModule.resource;

    assert.deepEqual(Object.keys(resource.operations), ["list", "view"]);
    assert.equal(Object.hasOwn(resource.operations, "create"), false);
    assert.equal(resource.schema.updatedAt?.storage?.writeSerializer, "datetime-utc");
  }
});
