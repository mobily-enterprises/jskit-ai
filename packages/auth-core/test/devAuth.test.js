import assert from "node:assert/strict";
import test from "node:test";

import { parseBooleanFlag } from "../src/server/booleanFlag.js";
import {
  DEV_AUTH_SECRET_HEADER,
  assertDevAuthPolicy,
  ensureDevAuthExchangeAvailable,
  ensureDevAuthRuntimeAvailable,
  isLocalDevAuthRequest,
  resolveDevAuthPolicy
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
    nodeEnv: "development",
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
    () => assertDevAuthPolicy(enabledPolicy({ nodeEnv: "production" })),
    /must not be enabled in production/
  );
  assert.throws(
    () => assertDevAuthPolicy(enabledPolicy({ secret: "" })),
    /AUTH_DEV_BYPASS_SECRET is required/
  );
  assert.doesNotThrow(() => assertDevAuthPolicy(resolveDevAuthPolicy()));
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
