import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import descriptor from "../package.descriptor.mjs";
import crudCorePackage from "../../crud-core/package.json" with { type: "json" };
import resourceCrudCorePackage from "../../resource-crud-core/package.json" with { type: "json" };

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TEST_DIRECTORY, "..");

function readFileMutationById(id) {
  return descriptor.mutations.files.find((entry) => entry.id === id) || null;
}

test("users-core installs the app-local users package scaffold", () => {
  assert.equal(descriptor.mutations.dependencies.runtime["@local/users"], "file:packages/users");
  assert.equal(descriptor.mutations.dependencies.runtime["@jskit-ai/crud-core"], crudCorePackage.version);
  assert.equal(
    descriptor.mutations.dependencies.runtime["@jskit-ai/resource-crud-core"],
    resourceCrudCorePackage.version
  );

  const expectedFileIds = [
    "users-core-users-package-json",
    "users-core-users-package-descriptor-base",
    "users-core-users-package-descriptor-workspace",
    "users-core-users-provider-base",
    "users-core-users-provider-workspace",
    "users-core-users-actions-base",
    "users-core-users-actions-workspace",
    "users-core-users-routes-base",
    "users-core-users-routes-workspace",
    "users-core-users-repository",
    "users-core-users-service",
    "users-core-users-shared-index",
    "users-core-users-resource"
  ];

  for (const fileId of expectedFileIds) {
    const mutation = readFileMutationById(fileId);
    assert.ok(mutation, `Missing users-core scaffold file mutation ${fileId}.`);
    assert.equal(mutation.ownership, "app", `${fileId} must remain app-owned.`);
    assert.equal(mutation.preserveOnRemove, true, `${fileId} must remain preserved on remove.`);
    assert.ok(mutation.to.startsWith("packages/users/"), `${fileId} must target packages/users.`);
    assert.ok(mutation.from, `${fileId} must define a template source.`);
    assert.ok(mutation.reason, `${fileId} must document why it exists.`);
  }
});

test("users-core base users package templates stay aligned with non-workspace apps", async () => {
  const packageDescriptorSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users/package.descriptor.mjs"),
    "utf8"
  );
  const providerSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users/src/server/UsersProvider.js"),
    "utf8"
  );
  const actionsSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users/src/server/actions.js"),
    "utf8"
  );
  const repositorySource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users/src/server/repository.js"),
    "utf8"
  );
  const serviceSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users/src/server/service.js"),
    "utf8"
  );
  const routesSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users/src/server/registerRoutes.js"),
    "utf8"
  );

  assert.doesNotMatch(packageDescriptorSource, /@jskit-ai\/workspaces-core/);
  assert.match(packageDescriptorSource, /@jskit-ai\/json-rest-api-core/);
  assert.match(packageDescriptorSource, /json-rest-api\.core/);
  assert.doesNotMatch(packageDescriptorSource, /server\/actionIds/);
  assert.match(providerSource, /surface: "home"/);
  assert.doesNotMatch(providerSource, /routeSurfaceRequiresWorkspace/);
  assert.doesNotMatch(providerSource, /createCrudLookup/);
  assert.doesNotMatch(providerSource, /lookup\.users/);
  assert.doesNotMatch(providerSource, /normalizeRecordId/);
  assert.doesNotMatch(providerSource, /requires application singleton\(\)\/service\(\)\/actions\(\)\./);
  assert.match(providerSource, /createJsonRestResourceScopeOptions/);
  assert.match(providerSource, /addResourceIfMissing\(\s*api,\s*"users",\s*createJsonRestResourceScopeOptions\(resource,/s);
  assert.match(repositorySource, /api\.resources\.users\.query\(/);
  assert.match(repositorySource, /api\.resources\.users\.get\(/);
  assert.match(repositorySource, /async function queryDocuments\(query = \{\}, options = \{\}\)/);
  assert.match(repositorySource, /async function getDocumentById\(recordId, options = \{\}\)/);
  assert.match(repositorySource, /returnNullWhenJsonRestResourceMissing/);
  assert.doesNotMatch(actionsSource, /workspaceSlugParamsValidator/);
  assert.doesNotMatch(actionsSource, /requireActionSurface/);
  assert.match(actionsSource, /orderBy: resource\.defaultSort/);
  assert.match(actionsSource, /output: null/);
  assert.match(actionsSource, /usersService\.queryDocuments/);
  assert.match(actionsSource, /usersService\.getDocumentById/);
  assert.doesNotMatch(actionsSource, /from "\.\/actionIds\.js"/);
  assert.match(actionsSource, /id: "crud\.users\.list"/);
  assert.match(actionsSource, /id: "crud\.users\.view"/);
  assert.doesNotMatch(serviceSource, /serviceEvents/);
  assert.match(serviceSource, /throw new TypeError\("createService requires usersRepository\."\);/);
  assert.match(serviceSource, /return404IfNotFound/);
  assert.match(serviceSource, /throw new AppError\(404, "Document not found\."\);/);
  assert.match(serviceSource, /returnJsonApiDocument/);
  assert.doesNotMatch(routesSource, /workspaceRouteInput/);
  assert.match(routesSource, /createJsonApiResourceRouteContract/);
  assert.doesNotMatch(routesSource, /wrapResponse/);
  assert.match(routesSource, /routeBase: "\/"/);
  assert.match(routesSource, /orderBy: resource\.defaultSort/);
});

test("users-core workspace users package templates stay aligned with workspace apps", async () => {
  const packageDescriptorSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users-workspace/package.descriptor.mjs"),
    "utf8"
  );
  const providerSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users-workspace/src/server/UsersProvider.js"),
    "utf8"
  );
  const actionsSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users-workspace/src/server/actions.js"),
    "utf8"
  );
  const routesSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users-workspace/src/server/registerRoutes.js"),
    "utf8"
  );
  const serviceSource = await readFile(
    path.join(PACKAGE_ROOT, "templates/packages/users/src/server/service.js"),
    "utf8"
  );

  assert.match(packageDescriptorSource, /@jskit-ai\/workspaces-core/);
  assert.match(packageDescriptorSource, /@jskit-ai\/json-rest-api-core/);
  assert.match(packageDescriptorSource, /json-rest-api\.core/);
  assert.doesNotMatch(packageDescriptorSource, /server\/actionIds/);
  assert.match(providerSource, /surface: "admin"/);
  assert.match(providerSource, /routeSurfaceRequiresWorkspace/);
  assert.doesNotMatch(providerSource, /createCrudLookup/);
  assert.doesNotMatch(providerSource, /lookup\.users/);
  assert.doesNotMatch(providerSource, /normalizeRecordId/);
  assert.doesNotMatch(providerSource, /requires application singleton\(\)\/service\(\)\/actions\(\)\./);
  assert.match(providerSource, /createJsonRestResourceScopeOptions/);
  assert.match(providerSource, /addResourceIfMissing\(\s*api,\s*"users",\s*createJsonRestResourceScopeOptions\(resource,/s);
  assert.match(actionsSource, /workspaceSlugParamsValidator/);
  assert.doesNotMatch(actionsSource, /requireActionSurface/);
  assert.match(actionsSource, /orderBy: resource\.defaultSort/);
  assert.match(actionsSource, /usersService\.queryDocuments/);
  assert.match(actionsSource, /usersService\.getDocumentById/);
  assert.doesNotMatch(actionsSource, /from "\.\/actionIds\.js"/);
  assert.match(actionsSource, /id: "crud\.users\.list"/);
  assert.match(actionsSource, /id: "crud\.users\.view"/);
  assert.match(routesSource, /buildWorkspaceInputFromRouteParams/);
  assert.match(routesSource, /createJsonApiResourceRouteContract/);
  assert.doesNotMatch(routesSource, /wrapResponse/);
  assert.match(routesSource, /routeBase: routeSurfaceRequiresWorkspace === true \? "\/w\/:workspaceSlug" : "\/"/);
  assert.doesNotMatch(serviceSource, /serviceEvents/);
  assert.match(serviceSource, /throw new TypeError\("createService requires usersRepository\."\);/);
  assert.match(serviceSource, /returnJsonApiDocument/);
});

test("users-core local users resource scaffold stays read-only and canonical", async () => {
  const resourceModule = await import(
    pathToFileURL(path.join(PACKAGE_ROOT, "templates/packages/users/src/shared/userResource.js")).href
  );
  const resource = resourceModule?.resource;

  assert.equal(typeof resource, "object");
  assert.deepEqual(Object.keys(resource.operations), ["list", "view"]);
  assert.equal(Object.hasOwn(resource.operations, "create"), false);
});
