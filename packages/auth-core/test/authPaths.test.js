import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_PATHS, buildAuthOauthStartPath } from "../src/shared/authPaths.js";

test("AUTH_PATHS defines canonical auth endpoint paths", () => {
  assert.equal(Object.isFrozen(AUTH_PATHS), true);
  assert.equal(AUTH_PATHS.LOGIN, "/api/login");
  assert.equal(AUTH_PATHS.LOGOUT, "/api/logout");
  assert.equal(AUTH_PATHS.SESSION, "/api/session");
  assert.equal(AUTH_PATHS.OAUTH_START_TEMPLATE, "/api/oauth/:provider/start");
});

test("buildAuthOauthStartPath normalizes and encodes provider id", () => {
  assert.equal(buildAuthOauthStartPath("GitHub"), "/api/oauth/github/start");
  assert.equal(buildAuthOauthStartPath("Git Hub"), "/api/oauth/git%20hub/start");
});
