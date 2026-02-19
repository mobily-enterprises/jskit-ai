import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSubscribeContextRequest,
  normalizeConnectionSurface,
  normalizeWorkspaceSlug
} from "../server/fastify/realtime/subscribeContext.js";

test("normalizeWorkspaceSlug accepts valid workspace slugs and rejects malformed values", () => {
  assert.equal(normalizeWorkspaceSlug("Acme-123"), "acme-123");
  assert.equal(normalizeWorkspaceSlug(""), "");
  assert.equal(normalizeWorkspaceSlug("  "), "");
  assert.equal(normalizeWorkspaceSlug("bad slug"), "");
  assert.equal(normalizeWorkspaceSlug("_bad"), "");
});

test("normalizeConnectionSurface defaults missing values and rejects unsupported ones", () => {
  assert.equal(normalizeConnectionSurface(""), "app");
  assert.equal(normalizeConnectionSurface("admin"), "admin");
  assert.equal(normalizeConnectionSurface("futuristic"), "");
});

test("buildSubscribeContextRequest force-overrides surface and workspace headers", () => {
  const request = {
    headers: {
      "x-surface-id": "app",
      "x-workspace-slug": "wrong"
    },
    params: {
      workspaceSlug: "wrong"
    },
    query: {
      workspaceSlug: "wrong"
    },
    raw: {
      url: "/api/realtime"
    }
  };

  const contextRequest = buildSubscribeContextRequest(request, "acme", "admin");

  assert.equal(contextRequest.headers["x-surface-id"], "admin");
  assert.equal(contextRequest.headers["x-workspace-slug"], "acme");
  assert.equal(contextRequest.params.workspaceSlug, "acme");
  assert.equal(contextRequest.query.workspaceSlug, "acme");
  assert.equal(contextRequest.url, "/admin/w/acme");
  assert.equal(contextRequest.raw.url, "/admin/w/acme");
});

test("buildSubscribeContextRequest keeps normalized surface with malformed/missing slug", () => {
  const malformed = buildSubscribeContextRequest(
    {
      headers: {
        "x-surface-id": "console"
      }
    },
    "bad slug",
    "console"
  );

  assert.equal(malformed.headers["x-surface-id"], "console");
  assert.equal(malformed.headers["x-workspace-slug"], "");
  assert.equal(malformed.url, "/console/w/none");
});

test("buildSubscribeContextRequest defaults surface to app when none is provided", () => {
  const contextRequest = buildSubscribeContextRequest(
    {
      headers: {
        "x-surface-id": "admin"
      }
    },
    "acme"
  );

  assert.equal(contextRequest.headers["x-surface-id"], "app");
  assert.equal(contextRequest.url, "/w/acme");
});

test("buildSubscribeContextRequest throws for unsupported connection surfaces", () => {
  assert.throws(() => buildSubscribeContextRequest({}, "acme", "futuristic"), /Unsupported connection surface/);
});
