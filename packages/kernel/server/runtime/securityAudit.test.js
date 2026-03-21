import assert from "node:assert/strict";
import test from "node:test";

import { buildAuditEventBase, __testables } from "./securityAudit.js";

const { resolveAuditSurface } = __testables;

test("resolveAuditSurface prefers explicit surface", () => {
  assert.equal(resolveAuditSurface("/", " Admin "), "admin");
});

test("resolveAuditSurface resolves surface from pathname resolver before default", () => {
  const resolved = resolveAuditSurface(
    "/admin/users",
    "",
    (pathname) => (pathname.startsWith("/admin") ? "console" : ""),
    "home"
  );

  assert.equal(resolved, "console");
});

test("resolveAuditSurface uses configured default and falls back to public", () => {
  assert.equal(resolveAuditSurface("/", "", null, "home"), "home");
  assert.equal(resolveAuditSurface("/", "", null, ""), "public");
});

test("buildAuditEventBase uses default surface id when request surface is missing", () => {
  const event = buildAuditEventBase(
    {
      id: "req-1",
      method: "GET",
      headers: {}
    },
    {
      defaultSurfaceId: "console"
    }
  );

  assert.equal(event.surface, "console");
});
