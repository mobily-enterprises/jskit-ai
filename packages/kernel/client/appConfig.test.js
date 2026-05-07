import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_APP_CONFIG_GLOBAL_KEY,
  getClientAppConfig,
  resolveClientAssetMode,
  resolveMobileConfig,
  setClientAppConfig
} from "./appConfig.js";

test("resolveMobileConfig and resolveClientAssetMode read normalized client mobile config", () => {
  const previous = globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY];

  try {
    setClientAppConfig({
      mobile: {
        enabled: true,
        strategy: "capacitor",
        assetMode: "dev_server",
        auth: {
          customScheme: "convict"
        }
      }
    });

    assert.equal(getClientAppConfig().mobile.enabled, true);
    assert.deepEqual(resolveMobileConfig(), {
      enabled: true,
      strategy: "capacitor",
      appId: "",
      appName: "",
      assetMode: "dev_server",
      devServerUrl: "",
      apiBaseUrl: "",
      auth: {
        callbackPath: "/auth/login",
        customScheme: "convict",
        appLinkDomains: []
      },
      android: {
        packageName: "",
        minSdk: 26,
        targetSdk: 35,
        versionCode: 1,
        versionName: "1.0.0"
      }
    });
    assert.equal(resolveClientAssetMode(), "dev_server");
  } finally {
    if (previous === undefined) {
      delete globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY];
    } else {
      globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY] = previous;
    }
  }
});

test("resolveMobileConfig accepts explicit appConfig values", () => {
  const mobileConfig = resolveMobileConfig({
    mobile: {
      enabled: true,
      appId: "com.example.app",
      appName: "Example App"
    }
  });

  assert.equal(mobileConfig.enabled, true);
  assert.equal(mobileConfig.appId, "com.example.app");
  assert.equal(mobileConfig.appName, "Example App");
  assert.equal(resolveClientAssetMode({}), "bundled");
});
