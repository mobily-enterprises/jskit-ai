import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveClientAssetMode,
  resolveMobileCallbackUrls,
  resolveMobileConfig
} from "./appConfig.js";

test("resolveMobileConfig reads the normalized mobile config from appConfig", () => {
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
