import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultApplyRoutePolicy as applyHttpRoutePolicy,
  normalizeRoutePolicyConfig as normalizeHttpRoutePolicyConfig
} from "../http/lib/kernel.js";
import { __testables as runtimeRouteRegistrationTestables } from "./apiRouteRegistration.js";
import {
  defaultApplyRoutePolicy as applyCanonicalRoutePolicy,
  normalizeRoutePolicyConfig as normalizeCanonicalRoutePolicyConfig
} from "../support/routePolicyConfig.js";

test("route policy mapping is sourced from one canonical mapper in both registration paths", () => {
  assert.equal(applyHttpRoutePolicy, applyCanonicalRoutePolicy);
  assert.equal(runtimeRouteRegistrationTestables.defaultApplyRoutePolicy, applyCanonicalRoutePolicy);
  assert.equal(normalizeHttpRoutePolicyConfig, normalizeCanonicalRoutePolicyConfig);
  assert.equal(runtimeRouteRegistrationTestables.normalizeRoutePolicyConfig, normalizeCanonicalRoutePolicyConfig);
});

test("route policy parity matrix stays aligned across http/runtime registration", () => {
  const ownerResolver = () => 42;

  const matrix = [
    {
      label: "auth maps to authPolicy",
      route: { auth: "required" },
      expectedConfig: { seed: "x", authPolicy: "required" }
    },
    {
      label: "contextPolicy maps through",
      route: { contextPolicy: "required" },
      expectedConfig: { seed: "x", contextPolicy: "required" }
    },
    {
      label: "surface maps through",
      route: { surface: "admin" },
      expectedConfig: { seed: "x", surface: "admin" }
    },
    {
      label: "visibility is normalized",
      route: { visibility: "USER" },
      expectedConfig: { seed: "x", visibility: "user" }
    },
    {
      label: "permission maps through",
      route: { permission: "workspace.settings.read" },
      expectedConfig: { seed: "x", permission: "workspace.settings.read" }
    },
    {
      label: "ownerParam maps through",
      route: { ownerParam: "userId" },
      expectedConfig: { seed: "x", ownerParam: "userId" }
    },
    {
      label: "userField maps through",
      route: { userField: "accountId" },
      expectedConfig: { seed: "x", userField: "accountId" }
    },
    {
      label: "ownerResolver maps through",
      route: { ownerResolver },
      expectedConfig: { seed: "x", ownerResolver }
    },
    {
      label: "csrfProtection maps through",
      route: { csrfProtection: false },
      expectedConfig: { seed: "x", csrfProtection: false }
    },
    {
      label: "route fields override existing config values",
      routeOptionsConfig: { authPolicy: "public", visibility: "public", seed: "x" },
      route: { auth: "own", visibility: "WORKSPACE" },
      expectedConfig: { seed: "x", authPolicy: "own", visibility: "workspace" }
    },
    {
      label: "unmapped route fields do not alter config",
      route: { rateLimit: { max: 1, timeWindow: "1 second" } },
      expectedConfig: { seed: "x" }
    }
  ];

  for (const testCase of matrix) {
    const routeOptions = {
      method: "GET",
      url: "/demo",
      config: {
        seed: "x",
        ...(testCase.routeOptionsConfig || {})
      }
    };
    const route = {
      method: "GET",
      path: "/demo",
      ...(testCase.route || {})
    };

    const canonical = applyCanonicalRoutePolicy(routeOptions, route);
    const fromHttp = applyHttpRoutePolicy(routeOptions, route);
    const fromRuntime = runtimeRouteRegistrationTestables.defaultApplyRoutePolicy(routeOptions, route);

    assert.deepEqual(
      canonical.config,
      testCase.expectedConfig,
      `canonical mapping failed for case: ${testCase.label}`
    );
    assert.deepEqual(fromHttp, canonical, `http mapping drifted for case: ${testCase.label}`);
    assert.deepEqual(fromRuntime, canonical, `runtime mapping drifted for case: ${testCase.label}`);
  }
});
