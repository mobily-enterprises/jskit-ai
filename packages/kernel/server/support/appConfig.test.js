import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KERNEL_SURFACE_ID,
  resolveAppConfig,
  normalizeDefaultSurfaceId,
  resolveDefaultSurfaceId
} from "./appConfig.js";

test("resolveAppConfig returns normalized appConfig when scope exposes appConfig binding", () => {
  const config = resolveAppConfig({
    has(token) {
      return token === "appConfig";
    },
    make(token) {
      assert.equal(token, "appConfig");
      return {
        surfaceDefaultId: "home"
      };
    }
  });

  assert.deepEqual(config, {
    surfaceDefaultId: "home"
  });
});

test("resolveAppConfig returns empty object when scope has no appConfig binding", () => {
  const config = resolveAppConfig({
    has() {
      return false;
    },
    make() {
      throw new Error("make should not be called");
    }
  });

  assert.deepEqual(config, {});
});

test("resolveAppConfig returns empty object for non-container values", () => {
  assert.deepEqual(resolveAppConfig(null), {});
  assert.deepEqual(resolveAppConfig({}), {});
  assert.deepEqual(resolveAppConfig({ has: () => true }), {});
});

test("normalizeDefaultSurfaceId normalizes explicit values and fallback values", () => {
  assert.equal(normalizeDefaultSurfaceId(" HOME "), "home");
  assert.equal(normalizeDefaultSurfaceId("", { fallback: " Console " }), "console");
  assert.equal(normalizeDefaultSurfaceId("", { fallback: "" }), DEFAULT_KERNEL_SURFACE_ID);
});

test("resolveDefaultSurfaceId prefers explicit default surface", () => {
  const surfaceId = resolveDefaultSurfaceId(
    {
      has(token) {
        return token === "appConfig";
      },
      make() {
        return {
          surfaceDefaultId: "admin"
        };
      }
    },
    {
      defaultSurfaceId: "home"
    }
  );

  assert.equal(surfaceId, "home");
});

test("resolveDefaultSurfaceId falls back to appConfig and then kernel default", () => {
  const fromAppConfig = resolveDefaultSurfaceId({
    has(token) {
      return token === "appConfig";
    },
    make() {
      return {
        surfaceDefaultId: "console"
      };
    }
  });
  assert.equal(fromAppConfig, "console");

  const fromKernelFallback = resolveDefaultSurfaceId({
    has() {
      return false;
    },
    make() {
      throw new Error("make should not be called");
    }
  });
  assert.equal(fromKernelFallback, DEFAULT_KERNEL_SURFACE_ID);
});
