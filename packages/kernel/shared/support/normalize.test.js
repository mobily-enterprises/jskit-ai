import test from "node:test";
import assert from "node:assert/strict";
import {
  hasValue,
  normalizeBoolean,
  normalizeCanonicalRecordIdText,
  normalizeFiniteInteger,
  normalizeFiniteNumber,
  normalizeIfInSource,
  normalizeIfPresent,
  normalizeMobileCallbackPath,
  normalizeMobileConfig,
  normalizeOrNull,
  normalizeRecordId,
  normalizeOpaqueId,
  normalizePositiveInteger,
  normalizeOneOf,
  normalizeQueryToken,
  normalizeText,
  normalizeUniqueTextList
} from "./normalize.js";

test("hasValue returns false for nullish and blank text, true otherwise", () => {
  assert.equal(hasValue(null), false);
  assert.equal(hasValue(undefined), false);
  assert.equal(hasValue(""), false);
  assert.equal(hasValue("   "), false);
  assert.equal(hasValue("0"), true);
  assert.equal(hasValue("-"), true);
  assert.equal(hasValue(0), true);
  assert.equal(hasValue(false), true);
  assert.equal(hasValue([]), true);
  assert.equal(hasValue({}), true);
});

test("normalizeQueryToken trims, lowercases, and falls back when empty", () => {
  assert.equal(normalizeQueryToken("  Admin  "), "admin");
  assert.equal(normalizeQueryToken(""), "__none__");
  assert.equal(normalizeQueryToken(null), "__none__");
  assert.equal(normalizeQueryToken("   ", { fallback: "surface" }), "surface");
});

test("normalizeOneOf returns normalized value when supported", () => {
  assert.equal(normalizeOneOf(" Compact ", ["compact", "comfortable"], "comfortable"), "compact");
});

test("normalizeOneOf returns fallback when value is unsupported", () => {
  assert.equal(normalizeOneOf("wide", ["compact", "comfortable"], "comfortable"), "comfortable");
});

test("normalizeOneOf falls back to first allowed value when fallback is empty", () => {
  assert.equal(normalizeOneOf("", ["compact", "comfortable"], ""), "compact");
});

test("normalizePositiveInteger normalizes valid integers and applies fallback", () => {
  assert.equal(normalizePositiveInteger("12"), 12);
  assert.equal(normalizePositiveInteger(0), 0);
  assert.equal(normalizePositiveInteger(-1), 0);
  assert.equal(
    normalizePositiveInteger("abc", {
      fallback: null
    }),
    null
  );
});

test("normalizeBoolean normalizes supported boolean-like values", () => {
  assert.equal(normalizeBoolean(true), true);
  assert.equal(normalizeBoolean(false), false);
  assert.equal(normalizeBoolean(1), true);
  assert.equal(normalizeBoolean(0), false);
  assert.equal(normalizeBoolean(" yes "), true);
  assert.equal(normalizeBoolean("No"), false);
  assert.throws(() => normalizeBoolean("maybe"), /Boolean field must be true or false/);
});

test("normalizeFiniteNumber normalizes numeric values", () => {
  assert.equal(normalizeFiniteNumber("42.5"), 42.5);
  assert.equal(normalizeFiniteNumber("7"), 7);
  assert.throws(() => normalizeFiniteNumber("abc"), /Number field must be a valid number/);
});

test("normalizeFiniteInteger normalizes integer values", () => {
  assert.equal(normalizeFiniteInteger("7"), 7);
  assert.throws(
    () => normalizeFiniteInteger("3.2"),
    /Number field must be an integer/
  );
});

test("normalizeIfInSource normalizes only present source fields", () => {
  const source = {
    firstName: "  Ada  "
  };
  const normalized = {};

  normalizeIfInSource(source, normalized, "firstName", normalizeText);
  normalizeIfInSource(source, normalized, "lastName", normalizeText);

  assert.deepEqual(normalized, {
    firstName: "Ada"
  });
});

test("normalizeIfInSource passes through nullish values without normalizer", () => {
  const source = {
    firstName: null,
    lastName: undefined
  };
  const normalized = {};

  normalizeIfInSource(source, normalized, "firstName", normalizeText);
  normalizeIfInSource(source, normalized, "lastName", normalizeText);

  assert.deepEqual(normalized, {
    firstName: null,
    lastName: undefined
  });
});

test("normalizeIfInSource annotates thrown normalizer errors with fieldErrors", () => {
  const source = {
    temperament: "unknowne"
  };
  const normalized = {};

  assert.throws(
    () =>
      normalizeIfInSource(source, normalized, "temperament", () => {
        throw new Error("Invalid pet temperament \"unknowne\".");
      }),
    (error) => {
      assert.deepEqual(error?.fieldErrors, {
        temperament: "Invalid pet temperament \"unknowne\"."
      });
      assert.deepEqual(error?.details?.fieldErrors, {
        temperament: "Invalid pet temperament \"unknowne\"."
      });
      return true;
    }
  );
});

test("normalizeIfInSource validates target and function arguments", () => {
  assert.throws(
    () => normalizeIfInSource({ firstName: "Ada" }, null, "firstName", normalizeText),
    /requires target object/
  );
  assert.throws(
    () => normalizeIfInSource({ firstName: "Ada" }, {}, "", normalizeText),
    /requires fieldName/
  );
  assert.throws(
    () => normalizeIfInSource({ firstName: "Ada" }, {}, "firstName", null),
    /requires normalizer function/
  );
});

test("normalizeIfPresent normalizes non-nullish values and preserves nullish values", () => {
  assert.equal(normalizeIfPresent("  Ada  ", normalizeText), "Ada");
  assert.equal(normalizeIfPresent(null, normalizeText), null);
  assert.equal(normalizeIfPresent(undefined, normalizeText), undefined);
  assert.throws(
    () => normalizeIfPresent("Ada", null),
    /requires normalizer function/
  );
});

test("normalizeOrNull normalizes non-nullish values and coerces nullish to null", () => {
  assert.equal(normalizeOrNull("  Ada  ", normalizeText), "Ada");
  assert.equal(normalizeOrNull(null, normalizeText), null);
  assert.equal(normalizeOrNull(undefined, normalizeText), null);
  assert.throws(
    () => normalizeOrNull("Ada", null),
    /requires normalizer function/
  );
});

test("normalizeRecordId accepts canonical string, safe integer, and bigint identifiers", () => {
  const unsafeNumericId = Number(9007199254740993n);
  assert.equal(normalizeRecordId("  7  "), "7");
  assert.equal(normalizeRecordId(7), "7");
  assert.equal(normalizeRecordId(10n), "10");
  assert.equal(normalizeRecordId(7.5), null);
  assert.equal(normalizeRecordId(0), null);
  assert.equal(normalizeRecordId(unsafeNumericId), null);
  assert.equal(normalizeRecordId(""), null);
  assert.equal(normalizeRecordId(null), null);
});

test("normalizeCanonicalRecordIdText validates canonical positive decimal identifiers", () => {
  assert.equal(normalizeCanonicalRecordIdText("  7  "), "7");
  assert.equal(normalizeCanonicalRecordIdText("007"), null);
  assert.equal(normalizeCanonicalRecordIdText("0"), null);
  assert.equal(normalizeCanonicalRecordIdText("abc"), null);
});

test("normalizeOpaqueId preserves opaque identifiers", () => {
  assert.equal(normalizeOpaqueId("  user-123  "), "user-123");
  assert.equal(normalizeOpaqueId(7), "7");
  assert.equal(normalizeOpaqueId(0), "0");
  assert.equal(normalizeOpaqueId(10n), "10");
  assert.equal(normalizeOpaqueId(""), null);
  assert.equal(normalizeOpaqueId(null), null);
});

test("normalizeUniqueTextList trims, dedupes, and supports optional single values", () => {
  assert.deepEqual(normalizeUniqueTextList([" one ", "two", "one", "", null]), ["one", "two"]);
  assert.deepEqual(normalizeUniqueTextList("one"), []);
  assert.deepEqual(
    normalizeUniqueTextList(" one ", {
      acceptSingle: true
    }),
    ["one"]
  );
});

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
