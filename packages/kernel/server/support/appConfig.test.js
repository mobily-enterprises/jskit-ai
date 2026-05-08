import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAppConfig,
  resolveClientAssetMode,
  normalizeDefaultSurfaceId,
  resolveDefaultSurfaceId,
  resolveMobileCallbackUrls,
  resolveMobileConfig
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
  assert.equal(normalizeDefaultSurfaceId("", { fallback: "" }), "");
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

test("resolveDefaultSurfaceId falls back to appConfig and then empty default", () => {
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
  assert.equal(fromKernelFallback, "");
});

test("resolveMobileConfig reads the normalized mobile config from raw appConfig or scope", () => {
  const fromRaw = resolveMobileConfig({
    mobile: {
      enabled: true,
      strategy: "capacitor",
      assetMode: "dev_server",
      auth: {
        customScheme: "convict"
      }
    }
  });

  assert.equal(fromRaw.enabled, true);
  assert.equal(fromRaw.strategy, "capacitor");
  assert.equal(fromRaw.assetMode, "dev_server");
  assert.equal(fromRaw.auth.customScheme, "convict");

  const fromScope = resolveMobileConfig({
    has(token) {
      return token === "appConfig";
    },
    make() {
      return {
        mobile: {
          enabled: true,
          strategy: "capacitor"
        }
      };
    }
  });
  assert.equal(fromScope.enabled, true);
  assert.equal(fromScope.strategy, "capacitor");
});

test("resolveClientAssetMode returns the normalized mobile asset mode", () => {
  assert.equal(
    resolveClientAssetMode({
      mobile: {
        assetMode: "dev_server"
      }
    }),
    "dev_server"
  );
  assert.equal(resolveClientAssetMode({}), "bundled");
});

test("resolveMobileCallbackUrls resolves web, mobile, and app-link callback URLs", () => {
  const callbackUrls = resolveMobileCallbackUrls(
    {
      mobile: {
        auth: {
          callbackPath: "/auth/login",
          customScheme: "convict",
          appLinkDomains: ["app.example.com", "APP.EXAMPLE.COM"]
        }
      }
    },
    {
      appPublicUrl: "https://example.com/app"
    }
  );

  assert.deepEqual(callbackUrls, {
    callbackPath: "/auth/login",
    webCallbackUrl: "https://example.com/app/auth/login",
    mobileCallbackUrl: "convict://auth/login",
    appLinkCallbackUrls: ["https://app.example.com/auth/login"],
    callbackUrls: [
      "https://example.com/app/auth/login",
      "convict://auth/login",
      "https://app.example.com/auth/login"
    ]
  });
});

test("resolveMobileCallbackUrls omits invalid or unavailable callback targets", () => {
  const callbackUrls = resolveMobileCallbackUrls(
    {
      mobile: {
        auth: {
          callbackPath: "/auth/login"
        }
      }
    },
    {
      appPublicUrl: "notaurl"
    }
  );

  assert.deepEqual(callbackUrls, {
    callbackPath: "/auth/login",
    webCallbackUrl: "",
    mobileCallbackUrl: "",
    appLinkCallbackUrls: [],
    callbackUrls: []
  });
});
