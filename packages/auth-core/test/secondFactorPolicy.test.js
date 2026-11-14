import assert from "node:assert/strict";
import test from "node:test";
import { createFakeFastifyPolicyRuntime } from "../../../tooling/testUtils/fakeFastify.mjs";
import { authPolicyPlugin } from "../src/server/lib/index.js";
import { requireSecondFactor } from "../src/server/secondFactor.js";

const NOW = Date.parse("2026-11-13T10:00:00.000Z");
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const REQUIRED = Object.freeze({
  status: 403,
  code: "auth.secondFactor.required",
  message: "Confirm it's you with a code from your authenticator app."
});

/** The auth policy over one signed-in session whose second factor time a test sets. */
async function startPolicy({ hasPermission = () => true } = {}) {
  const { fastify, state } = createFakeFastifyPolicyRuntime();
  const denied = [];
  let secondFactorAt = "";
  await authPolicyPlugin({
    async resolveActor() {
      return { authenticated: true, actor: { id: 7 }, secondFactorAt, transientFailure: false };
    },
    hasPermission,
    onPolicyDenied(event) {
      denied.push(event.reason);
    }
  }, { appEnv: "test" })(fastify);
  return {
    state,
    denied,
    provedAt(value) {
      secondFactorAt = value;
    },
    async request(config) {
      const request = { method: "POST", raw: { url: "/api/console/action" }, headers: {}, params: {}, routeOptions: { config: { authPolicy: "required", ...config } } };
      await state.preHandler(request, {});
      return request;
    }
  };
}

test("a route that asks for a second factor refuses a session that has not proved one", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const policy = await startPolicy();
  assert.equal(policy.state.requestDecorators.has("secondFactorAt"), true);

  await assert.rejects(policy.request({ secondFactor: true }), { ...REQUIRED, params: {} });
  assert.deepEqual(policy.denied, ["second_factor_required"]);
  assert.equal((await policy.request({})).secondFactorAt, "", "a route without the option lets the session through");

  policy.provedAt(minutesAgo(90));
  assert.equal((await policy.request({ secondFactor: true })).secondFactorAt, minutesAgo(90), "any time in the session will do");
});

test("a dangerous action asks for a second factor proved within its max age", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const policy = await startPolicy();
  const freshCode = { secondFactor: { maxAgeSeconds: 300 } };

  policy.provedAt(minutesAgo(6));
  await assert.rejects(policy.request(freshCode), { ...REQUIRED, params: { maxAgeSeconds: 300 } });
  policy.provedAt(minutesAgo(5));
  await policy.request(freshCode);
  policy.provedAt(minutesAgo(1));
  await policy.request(freshCode);
  policy.provedAt("not a time");
  await assert.rejects(policy.request(freshCode), REQUIRED);
});

test("a caller without the route's permission is refused for that, not asked for a code", async () => {
  const policy = await startPolicy({ hasPermission: () => false });
  await assert.rejects(policy.request({ permission: "console.manage", secondFactor: true }), {
    status: 403,
    code: "auth.policy.permissionDenied"
  });
  assert.deepEqual(policy.denied, ["forbidden_permission"]);
});

test("requireSecondFactor refuses an action whose session has not proved its second factor as asked", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  assert.throws(() => requireSecondFactor({ secondFactorAt: "" }, true), { ...REQUIRED, params: {} });
  assert.throws(() => requireSecondFactor({}, true), REQUIRED);
  assert.throws(() => requireSecondFactor(null, true), REQUIRED, "a call without a request has no session to prove it");
  assert.throws(() => requireSecondFactor({ secondFactorAt: minutesAgo(10) }, { maxAgeSeconds: 300 }), {
    ...REQUIRED,
    params: { maxAgeSeconds: 300 }
  });
  requireSecondFactor({ secondFactorAt: minutesAgo(10) }, true);
  requireSecondFactor({ secondFactorAt: minutesAgo(1) }, { maxAgeSeconds: 300 });
  for (const requirement of [false, undefined, { maxAgeSeconds: 0 }, { maxAgeSeconds: "300" }]) {
    assert.throws(() => requireSecondFactor({ secondFactorAt: minutesAgo(1) }, requirement), TypeError);
  }
});
