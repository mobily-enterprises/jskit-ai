import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import packageJson from "../package.json" with { type: "json" };
import { userProfileTableResource } from "../src/shared/resources/userProfileResource.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patternRoot = path.join(packageRoot, "patterns", "user-administration-server");

test("users-core publishes agent-readable administration patterns and package-owned migrations", async () => {
  assert.equal(packageJson.jskit?.mutations, undefined);
  assert.deepEqual(packageJson.jskit?.migrations, { directories: ["migrations"] });

  const pattern = await readFile(path.join(patternRoot, "PATTERN.md"), "utf8");
  assert.match(pattern, /defineCrudFeature\(\)/);
  assert.match(pattern, /ownerRepository: "users\.profiles"/);
  assert.match(pattern, /Workspace operations are scoped before repository access/);
  assert.match(pattern, /null\/cleared fields/);
  assert.match(pattern, /defineCrudContract\(userProfileTableResource,/);
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
  assert.match(feature, /defineCrudFeature/);
  assert.match(feature, /surface: "home"/);
  assert.match(feature, /ownerRepository: "users\.profiles"/);
  assert.doesNotMatch(feature, /\.make\(|\.singleton\(|containerToken|repositoryToken|serviceToken/);
});

test("workspace user administration example takes workspaces-core's workspace CRUD scope", async () => {
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
  assert.match(feature, /ownerRepository: "users\.profiles"/);
  assert.match(feature, /visibility: "workspace"/);
  assert.match(feature, /import \{ WORKSPACE_CRUD_SCOPE \} from "@jskit-ai\/workspaces-core\/server\/support\/workspaceCrud";/);
  assert.match(feature, /scope: WORKSPACE_CRUD_SCOPE/);
  assert.doesNotMatch(feature, /\.make\(|\.singleton\(|containerToken|repositoryToken|serviceToken/);
});

test("both user administration variants stay read-only on users-core's one users table resource", async () => {
  for (const packageName of ["users", "users-workspace"]) {
    const packageRootPath = path.join(patternRoot, "example", "packages", packageName);
    const crudModulePath = path.join(packageRootPath, "src", "shared", "userCrud.js");
    const crudModule = await import(pathToFileURL(crudModulePath).href);
    const { userCrud } = crudModule;
    const manifest = JSON.parse(await readFile(path.join(packageRootPath, "package.json"), "utf8"));

    assert.deepEqual(Object.keys(crudModule), ["userCrud"]);
    assert.equal(userCrud.resource, userProfileTableResource);
    assert.equal(userCrud.namespace, "users");
    assert.deepEqual(Object.keys(userCrud.operations), ["list", "view"]);
    assert.equal(Object.hasOwn(userCrud.operations, "create"), false);
    assert.deepEqual(
      Object.keys(userCrud.operations.view.output.schema.getFieldDefinitions()).sort(),
      ["createdAt", "displayName", "email", "id", "updatedAt", "username"]
    );
    assert.doesNotMatch(await readFile(crudModulePath, "utf8"), /defineTableResource/);
    assert.ok(manifest.jskit.capabilities.requires.includes("users.profiles"));
    assert.equal(manifest.dependencies["@jskit-ai/users-core"], packageJson.version);
  }
});

test("the workspace variant lists and shows only the caller's workspace's active members", async () => {
  const { workspaceMembersOnly } = await import(pathToFileURL(path.join(
    patternRoot, "example", "packages", "users-workspace", "src", "server", "workspaceMembersOnly.js"
  )).href);
  const calls = [];
  const repository = {
    query: async (params) => (calls.push(["query", params.filters]), { data: [] }),
    get: async (id) => (calls.push(["get", id]), { data: { id } }),
    pageLimits: () => ({})
  };
  const memberships = { activeMemberIds: async (workspaceId) => (workspaceId === "7" ? ["1", "2"] : []) };
  const users = workspaceMembersOnly(repository, memberships);
  const options = { context: { workspace: { id: "7" } } };

  await users.query({ filters: { q: "ann" }, page: { size: 20 } }, options);
  await users.query({ filters: { id: ["2", "3"] } }, options);
  await users.query({ filters: { id: "3" } }, options);
  await users.query({}, { context: { workspace: { id: "8" } } });
  assert.deepEqual(calls.splice(0), [
    ["query", { q: "ann", id: ["1", "2"] }],
    ["query", { id: ["2"] }],
    ["query", { id: [] }],
    ["query", { id: [] }]
  ]);
  assert.deepEqual(await users.get("1", {}, options), { data: { id: "1" } });
  assert.equal(await users.get("3", {}, { ...options, missing: "skip" }), null);
  await assert.rejects(users.get("3", {}, options), (error) => error.status === 404 && error.code === "crud.document.notFound");
  assert.deepEqual(calls, [["get", "1"]]);
  assert.equal(users.pageLimits, repository.pageLimits);
});
