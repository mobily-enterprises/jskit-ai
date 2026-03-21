import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppConfig } from "./appConfig.js";

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
