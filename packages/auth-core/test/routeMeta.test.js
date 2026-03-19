import assert from "node:assert/strict";
import test from "node:test";

import { mergeAuthPolicy, withAuthPolicy } from "../src/server/lib/index.js";

test("withAuthPolicy applies stable defaults", () => {
  const wrapped = withAuthPolicy();
  assert.deepEqual(wrapped, {
    config: {
      authPolicy: "public",
      contextPolicy: "none",
      surface: "",
      permission: "",
      ownerParam: null,
      userField: "id",
      ownerResolver: null,
      csrfProtection: true
    }
  });
});

test("mergeAuthPolicy preserves existing config fields and adds auth policy defaults", () => {
  const merged = mergeAuthPolicy(
    {
      method: "GET",
      url: "/api/example",
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute"
        }
      }
    },
    {}
  );

  assert.deepEqual(merged.config, {
    rateLimit: {
      max: 5,
      timeWindow: "1 minute"
    },
    authPolicy: "public",
    contextPolicy: "none",
    surface: "",
    permission: "",
    ownerParam: null,
    userField: "id",
    ownerResolver: null,
    csrfProtection: true
  });
});

test("mergeAuthPolicy normalizes policy metadata and keeps explicit settings", () => {
  const resolver = () => 7;
  const merged = mergeAuthPolicy(
    {
      config: {
        authPolicy: "public",
        contextPolicy: "none"
      }
    },
    {
      authPolicy: "own",
      contextPolicy: "required",
      surface: "admin",
      permission: "workspace.members.manage",
      ownerParam: "userId",
      userField: "id",
      ownerResolver: resolver,
      csrfProtection: false
    }
  );

  assert.equal(merged.config.authPolicy, "own");
  assert.equal(merged.config.contextPolicy, "required");
  assert.equal(merged.config.surface, "admin");
  assert.equal(merged.config.permission, "workspace.members.manage");
  assert.equal(merged.config.ownerParam, "userId");
  assert.equal(merged.config.userField, "id");
  assert.equal(merged.config.ownerResolver, resolver);
  assert.equal(merged.config.csrfProtection, false);
});

test("mergeAuthPolicy coerces unsupported owner resolver values to null", () => {
  const merged = mergeAuthPolicy(
    {
      config: {
        ownerResolver: "not-a-function"
      }
    },
    {}
  );

  assert.equal(merged.config.ownerResolver, null);
});
