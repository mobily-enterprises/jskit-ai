import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRuntimeProfileFromSurface,
  shouldServePathForSurface,
  toRequestPathname
} from "./surfaceRuntime.js";

function createFakeSurfaceRuntime() {
  return {
    SURFACE_MODE_ALL: "all",
    normalizeSurfaceMode(value) {
      const normalized = String(value || "")
        .trim()
        .toLowerCase();
      if (!normalized || normalized === "all") {
        return "all";
      }
      return ["app", "admin", "console"].includes(normalized) ? normalized : "all";
    },
    resolveSurfaceFromPathname(pathname) {
      const normalized = String(pathname || "").trim();
      if (normalized === "/admin" || normalized.startsWith("/admin/")) {
        return "admin";
      }
      if (normalized === "/console" || normalized.startsWith("/console/")) {
        return "console";
      }
      return "app";
    },
    isSurfaceEnabled(surfaceId) {
      return ["app", "admin"].includes(surfaceId);
    }
  };
}

test("toRequestPathname strips query and survives invalid url", () => {
  assert.equal(toRequestPathname("/admin/users?id=1"), "/admin/users");
  assert.equal(toRequestPathname("///bad path"), "/bad path");
});

test("shouldServePathForSurface allows api and matching enabled surfaces", () => {
  const surfaceRuntime = createFakeSurfaceRuntime();
  assert.equal(
    shouldServePathForSurface({
      surfaceRuntime,
      pathname: "/api/v1/health",
      serverSurface: "admin"
    }),
    true
  );
  assert.equal(
    shouldServePathForSurface({
      surfaceRuntime,
      pathname: "/admin/users",
      serverSurface: "admin"
    }),
    true
  );
  assert.equal(
    shouldServePathForSurface({
      surfaceRuntime,
      pathname: "/console",
      serverSurface: "all"
    }),
    false
  );
});

test("shouldServePathForSurface allows descriptor-declared global ui paths", () => {
  const surfaceRuntime = createFakeSurfaceRuntime();
  assert.equal(
    shouldServePathForSurface({
      surfaceRuntime,
      pathname: "/auth/login",
      serverSurface: "admin",
      globalUiPaths: ["/auth/login", "/auth/signout"]
    }),
    true
  );
  assert.equal(
    shouldServePathForSurface({
      surfaceRuntime,
      pathname: "/auth/signout/complete",
      serverSurface: "admin",
      globalUiPaths: ["/auth/login", "/auth/signout"]
    }),
    true
  );
});

test("resolveRuntimeProfileFromSurface maps all mode to default profile", () => {
  const surfaceRuntime = createFakeSurfaceRuntime();
  assert.equal(
    resolveRuntimeProfileFromSurface({
      surfaceRuntime,
      serverSurface: "all",
      defaultProfile: "app"
    }),
    "app"
  );
  assert.equal(
    resolveRuntimeProfileFromSurface({
      surfaceRuntime,
      serverSurface: "admin",
      defaultProfile: "app"
    }),
    "admin"
  );
});
