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

// The list's pages are proved on the database in workspaces-core's userAdministrationExample.mysql.test.js: each page is
// chosen in SQL, so no statement reads the workspace's memberships whole.
test("the workspace variant shows only the caller's workspace's active members, reading one membership", async () => {
  const { workspaceMembersOnly } = await import(pathToFileURL(path.join(
    patternRoot, "example", "packages", "users-workspace", "src", "server", "workspaceMembersOnly.js"
  )).href);
  const calls = [];
  const repository = {
    query: async (params) => (calls.push(["query", params.filters]), { data: [] }),
    get: async (id) => (calls.push(["get", id]), { data: { id } }),
    pageLimits: () => ({ request: 100 }),
    // users.profiles' other methods read and write every user.
    findByEmail: async () => ({ id: "3" }),
    countUsers: async () => 3,
    upsert: async () => ({ id: "3" })
  };
  const memberCalls = [];
  const statuses = new Map([["7:1", "active"], ["7:2", "revoked"]]);
  const memberships = {
    findByWorkspaceIdAndUserId: async (workspaceId, userId, callOptions) => {
      memberCalls.push([workspaceId, userId, callOptions]);
      const status = statuses.get(`${workspaceId}:${userId}`);
      return status ? { workspaceId, userId, status } : null;
    }
  };
  const users = workspaceMembersOnly(repository, memberships);
  const options = { context: { workspace: { id: "7" } } };

  assert.deepEqual(await users.get("1", {}, options), { data: { id: "1" } });
  assert.equal(await users.get("2", {}, { ...options, missing: "skip" }), null);
  assert.equal(await users.get("3", {}, { ...options, missing: "skip" }), null);
  await assert.rejects(users.get("3", {}, options), (error) => error.status === 404 && error.code === "crud.document.notFound");
  await assert.rejects(users.get("1", {}, { context: { workspace: { id: "8" } } }), (error) => error.status === 404);
  assert.deepEqual(calls, [["get", "1"]]);
  // A context with no workspace lists nobody, without reading memberships.
  await users.query({ page: { size: 20 } }, { context: {}, format: "jsonapi" });
  assert.deepEqual(calls.at(-1), ["query", { id: [] }]);
  assert.equal(users.pageLimits, repository.pageLimits);
  // Only the narrowed reads pass through: nothing else of users.profiles reaches users past the workspace.
  assert.deepEqual(Object.keys(users).sort(), ["get", "pageLimits", "query"]);
  // The membership read gets only the context and transaction, never the view's own settings.
  const trx = { id: "trx" };
  await users.get("1", {}, { ...options, trx, format: "jsonapi", missing: "skip" });
  assert.deepEqual(memberCalls.at(-1), ["7", "1", { context: options.context, trx }]);
});
