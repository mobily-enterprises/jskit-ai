import assert from "node:assert/strict";
import test from "node:test";

import { parseBooleanFlag } from "../src/server/booleanFlag.js";
import {
  DEV_AUTH_SECRET_HEADER,
  assertDevAuthPolicy,
  ensureDevAuthExchangeAvailable,
  ensureDevAuthRuntimeAvailable,
  isDevAuthBootstrapEnabled,
  isLocalDevAuthRequest,
  resolveDevAuthPolicy,
  resolveDevAuthPolicyFromEnv
} from "../src/server/devAuth.js";

const DEV_AUTH_SECRET = "preview-exchange-secret";

function createRequest({
  headers = {},
  host = "localhost:4100",
  remoteAddress = "127.0.0.1"
} = {}) {
  return {
    headers: {
      host,
      ...headers
    },
    socket: {
      remoteAddress
    }
  };
}

function enabledPolicy(overrides = {}) {
  return resolveDevAuthPolicy({
    enabled: true,
    appEnv: "development",
    secret: DEV_AUTH_SECRET,
    ...overrides
  });
}

test("parseBooleanFlag normalizes conventional environment flag values", () => {
  assert.equal(parseBooleanFlag("YES"), true);
  assert.equal(parseBooleanFlag("off", true), false);
  assert.equal(parseBooleanFlag("unknown", true), true);
  assert.equal(parseBooleanFlag("", false), false);
});

test("dev auth policy rejects production and missing-secret enablement", () => {
  assert.throws(
    () => assertDevAuthPolicy(enabledPolicy({ appEnv: "staging" })),
    { message: /^AUTH_DEV_BYPASS_ENABLED is for development only: remove it from staging and production\.$/u }
  );
  assert.throws(
    () => assertDevAuthPolicy(enabledPolicy({ secret: "" })),
    /AUTH_DEV_BYPASS_SECRET is required/
  );
  assert.doesNotThrow(() => assertDevAuthPolicy(resolveDevAuthPolicy({ appEnv: "production" })), "off is allowed anywhere");
  assert.throws(() => resolveDevAuthPolicy({ enabled: true }), { message: /^APP_ENV is not set/u }, "never guesses development");
});

test("dev sign-in follows APP_ENV: allowed in development and test, refused in staging and production, whatever NODE_ENV", () => {
  const policyIn = (APP_ENV, NODE_ENV) => resolveDevAuthPolicyFromEnv({
    APP_ENV, NODE_ENV, AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: DEV_AUTH_SECRET
  });
  for (const APP_ENV of ["development", "test"]) {
    assert.equal(isDevAuthBootstrapEnabled(policyIn(APP_ENV, "production")), true, APP_ENV);
    assert.doesNotThrow(() => ensureDevAuthRuntimeAvailable(policyIn(APP_ENV, "production"), createRequest()), APP_ENV);
  }
  for (const APP_ENV of ["staging", "production"]) {
    const policy = policyIn(APP_ENV, "production");
    assert.equal(policy.isDeployed, true, APP_ENV);
    assert.equal(isDevAuthBootstrapEnabled(policy), false, APP_ENV);
    assert.throws(() => ensureDevAuthRuntimeAvailable(policy, createRequest()), { code: "auth.dev.unavailable" }, APP_ENV);
  }
  assert.throws(() => resolveDevAuthPolicyFromEnv({}), { message: /^APP_ENV is not set/u });
});

test("dev auth trusts only a direct loopback connection with a loopback Host", () => {
  assert.equal(isLocalDevAuthRequest(createRequest()), true);
  assert.equal(isLocalDevAuthRequest(createRequest({ host: "app.localhost:4100" })), true);
  assert.equal(isLocalDevAuthRequest(createRequest({ host: "example.com" })), false);
  assert.equal(isLocalDevAuthRequest(createRequest({ remoteAddress: "203.0.113.7" })), false);
  assert.equal(isLocalDevAuthRequest(createRequest({
    headers: {
      "x-forwarded-for": "127.0.0.1",
      "x-forwarded-host": "localhost"
    },
    host: "localhost:4100",
    remoteAddress: "203.0.113.7"
  })), false);
});

test("dev auth runtime accepts native session checks without the exchange header", () => {
  assert.doesNotThrow(() => ensureDevAuthRuntimeAvailable(enabledPolicy(), createRequest()));
});

test("dev auth exchange requires the exact fixed-header secret", () => {
  assert.doesNotThrow(() => ensureDevAuthExchangeAvailable(
    enabledPolicy(),
    createRequest({
      headers: {
        [DEV_AUTH_SECRET_HEADER]: DEV_AUTH_SECRET
      }
    })
  ));
  assert.throws(
    () => ensureDevAuthExchangeAvailable(enabledPolicy(), createRequest()),
    /not authorized/
  );
  assert.throws(
    () => ensureDevAuthExchangeAvailable(
      enabledPolicy(),
      createRequest({
        headers: {
          [DEV_AUTH_SECRET_HEADER]: `${DEV_AUTH_SECRET}-wrong`
        }
      })
    ),
    /not authorized/
  );
});

test("dev auth refusals carry their own codes", () => {
  const codeOf = (run) => {
    try {
      run();
    } catch (error) {
      return error.code;
    }
    return null;
  };
  assert.equal(codeOf(() => ensureDevAuthRuntimeAvailable(resolveDevAuthPolicy({ appEnv: "development" }), createRequest())), "auth.dev.unavailable");
  assert.throws(() => ensureDevAuthRuntimeAvailable(enabledPolicy({ secret: "" }), createRequest()), (error) =>
    error.message === "AUTH_DEV_BYPASS_SECRET is required when AUTH_DEV_BYPASS_ENABLED=true." && error.code === undefined);
  assert.equal(
    codeOf(() => ensureDevAuthRuntimeAvailable(enabledPolicy(), createRequest({ host: "example.com" }))),
    "auth.dev.localhostOnly"
  );
  assert.equal(codeOf(() => ensureDevAuthExchangeAvailable(enabledPolicy(), createRequest())), "auth.dev.exchangeUnauthorized");
});
