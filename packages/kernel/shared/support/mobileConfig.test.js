import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMobileCallbackPath, normalizeMobileConfig } from "./mobileConfig.js";

test("normalizeMobileCallbackPath normalizes auth callback paths", () => {
  assert.equal(normalizeMobileCallbackPath("auth/login"), "/auth/login");
  assert.equal(normalizeMobileCallbackPath("/auth/login"), "/auth/login");
  assert.equal(
    normalizeMobileCallbackPath("", {
      fallback: "/login/callback"
    }),
    "/login/callback"
  );
});

test("normalizeMobileConfig normalizes the mobile config contract", () => {
  const mobileConfig = normalizeMobileConfig({
    enabled: true,
    strategy: " Capacitor ",
    appId: "com.example.convict",
    appName: "Convict",
    assetMode: " dev_server ",
    devServerUrl: " http://192.168.1.10:5173 ",
    apiBaseUrl: " https://api.example.com ",
    auth: {
      callbackPath: "auth/login",
      customScheme: " Convict ",
      appLinkDomains: ["App.Example.com", " app.example.com "]
    },
    android: {
      packageName: "com.example.convict",
      minSdk: "28",
      targetSdk: "35",
      versionCode: "4",
      versionName: "2.0.0"
    }
  });

  assert.deepEqual(mobileConfig, {
    enabled: true,
    strategy: "capacitor",
    appId: "com.example.convict",
    appName: "Convict",
    assetMode: "dev_server",
    devServerUrl: "http://192.168.1.10:5173",
    apiBaseUrl: "https://api.example.com",
    auth: {
      callbackPath: "/auth/login",
      customScheme: "convict",
      appLinkDomains: ["app.example.com"]
    },
    android: {
      packageName: "com.example.convict",
      minSdk: 28,
      targetSdk: 35,
      versionCode: 4,
      versionName: "2.0.0"
    }
  });
});

test("normalizeMobileConfig applies defaults for missing fields", () => {
  const mobileConfig = normalizeMobileConfig({
    auth: {
      appLinkDomains: "app.example.com"
    },
    android: {
      minSdk: "bad",
      targetSdk: 0,
      versionCode: "",
      versionName: ""
    }
  });

  assert.deepEqual(mobileConfig, {
    enabled: false,
    strategy: "",
    appId: "",
    appName: "",
    assetMode: "bundled",
    devServerUrl: "",
    apiBaseUrl: "",
    auth: {
      callbackPath: "/auth/login",
      customScheme: "",
      appLinkDomains: ["app.example.com"]
    },
    android: {
      packageName: "",
      minSdk: 26,
      targetSdk: 35,
      versionCode: 1,
      versionName: "1.0.0"
    }
  });
});

test("normalizeMobileConfig preserves explicit false values from string input", () => {
  const mobileConfig = normalizeMobileConfig({
    enabled: "false"
  });

  assert.equal(mobileConfig.enabled, false);
});

test("normalizeMobileConfig rejects invalid assetMode values", () => {
  assert.throws(
    () => normalizeMobileConfig({
      assetMode: "weird"
    }),
    /config\.mobile\.assetMode must be "bundled" or "dev_server"\./u
  );
});
