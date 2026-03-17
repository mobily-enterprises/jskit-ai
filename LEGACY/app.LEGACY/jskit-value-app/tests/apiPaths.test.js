import assert from "node:assert/strict";
import test from "node:test";

import {
  API_PREFIX,
  buildVersionedApiPath,
  isApiPath,
  isVersionedApiPath,
  isVersionedApiPrefixMatch,
  normalizePathname,
  toVersionedApiPath,
  toVersionedApiPrefix
} from "../shared/apiPaths.js";

test("toVersionedApiPath normalizes API routes and preserves non-API routes", () => {
  assert.equal(toVersionedApiPath("/api"), "/api");
  assert.equal(toVersionedApiPath("/api/"), "/api");
  assert.equal(toVersionedApiPath("/api/workspace/projects"), "/api/workspace/projects");
  assert.equal(toVersionedApiPath("/api/workspace/projects"), "/api/workspace/projects");
  assert.equal(toVersionedApiPath("/api/v2/workspace/projects"), "/api/v2/workspace/projects");
  assert.equal(toVersionedApiPath("/api/console?query=1#hash"), "/api/console");
  assert.equal(toVersionedApiPath("/console/login"), "/console/login");
});

test("toVersionedApiPrefix returns slash-suffixed API prefixes", () => {
  assert.equal(toVersionedApiPrefix(), `${API_PREFIX}/`);
  assert.equal(toVersionedApiPrefix("/api"), `${API_PREFIX}/`);
  assert.equal(toVersionedApiPrefix("/api/workspace"), `${API_PREFIX}/workspace/`);
  assert.equal(toVersionedApiPrefix("/api/workspace/"), `${API_PREFIX}/workspace/`);
  assert.equal(toVersionedApiPrefix("/console"), "/console");
});

test("buildVersionedApiPath builds canonical API paths from suffixes", () => {
  assert.equal(buildVersionedApiPath(), API_PREFIX);
  assert.equal(buildVersionedApiPath(""), API_PREFIX);
  assert.equal(buildVersionedApiPath("/"), API_PREFIX);
  assert.equal(buildVersionedApiPath("workspace/projects"), `${API_PREFIX}/workspace/projects`);
  assert.equal(buildVersionedApiPath("/workspace/projects/"), `${API_PREFIX}/workspace/projects`);
  assert.equal(buildVersionedApiPath("/api/workspace/projects"), `${API_PREFIX}/workspace/projects`);
  assert.equal(buildVersionedApiPath("/api/workspace/projects"), `${API_PREFIX}/workspace/projects`);
  assert.equal(buildVersionedApiPath("/api/v2/workspace/projects"), "/api/v2/workspace/projects");
});

test("versioned API match helpers enforce prefix boundaries", () => {
  assert.equal(isVersionedApiPrefixMatch("/api"), true);
  assert.equal(isVersionedApiPrefixMatch("/api/"), true);
  assert.equal(isVersionedApiPrefixMatch("/api/console/errors"), true);
  assert.equal(isVersionedApiPrefixMatch("/api?query=1"), true);
  assert.equal(isVersionedApiPrefixMatch("/apix"), false);
  assert.equal(isVersionedApiPrefixMatch("/api2"), false);
  assert.equal(isVersionedApiPrefixMatch("/api/workspace"), false);

  assert.equal(isVersionedApiPath("/api"), true);
  assert.equal(isVersionedApiPath("/api/v2/workspace"), true);
  assert.equal(isVersionedApiPath("/apix"), false);
  assert.equal(isVersionedApiPath("/api/v/route"), false);
  assert.equal(isVersionedApiPath("/api"), false);
});

test("path normalization and API detection are boundary-safe", () => {
  assert.equal(normalizePathname(" api/workspace///?x=1#hash"), "/api/workspace");
  assert.equal(normalizePathname(""), "/");
  assert.equal(isApiPath("/api"), true);
  assert.equal(isApiPath("/api/workspace"), true);
  assert.equal(isApiPath("/apiary"), false);
  assert.equal(isApiPath("/ap"), false);
});
