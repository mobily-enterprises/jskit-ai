import assert from "node:assert/strict";
import test from "node:test";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createAuthActions } from "../src/server/actions/authActions.js";
import { createSecondFactorActions } from "../src/server/actions/secondFactorActions.js";
import { AuthFeature } from "../src/server/providers/AuthFeature.js";

test("auth logout action delegates directly to the selected auth service", async () => {
  const calls = [];
  const authService = {
    async logout(request) {
      calls.push(request);
      return { ok: true, clearSession: true };
    }
  };
  const action = createAuthActions({ authService }).find((definition) => definition.id === "auth.logout");
  const request = { id: "request-1" };
  assert.deepEqual(await action.execute({}, { requestMeta: { request } }), {
    ok: true,
    clearSession: true
  });
  assert.deepEqual(calls, [request]);
});

test("shared dev login-as action passes the trusted request to auth.service", async () => {
  const input = { email: "ada@example.com" };
  const request = { headers: { "x-jskit-dev-auth-secret": "secret" } };
  let received = null;
  const action = createAuthActions({
    authService: {
      async devLoginAs(receivedInput, receivedRequest) {
        received = { input: receivedInput, request: receivedRequest };
        return { ok: true };
      }
    }
  }).find((definition) => definition.id === "auth.dev.loginAs");
  assert.deepEqual(await action.execute(input, { requestMeta: { request } }), { ok: true });
  assert.deepEqual(received, { input, request });
});

test("second factor actions hand the request's own session and the input to auth.service", async () => {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push([name, ...args]);
    return { name };
  };
  const authService = {
    getSecondFactorStatus: record("getSecondFactorStatus"),
    startSecondFactorSetup: record("startSecondFactorSetup"),
    confirmSecondFactorSetup: record("confirmSecondFactorSetup"),
    verifySecondFactor: record("verifySecondFactor"),
    replaceSecondFactorRecoveryCodes: record("replaceSecondFactorRecoveryCodes"),
    removeSecondFactor: record("removeSecondFactor")
  };
  const request = { id: "request-1" };
  const actions = createSecondFactorActions({ authService });
  assert.deepEqual(actions.map((action) => [action.id, action.kind, action.permission]), [
    ["auth.secondFactor.read", "query", { require: "authenticated" }],
    ["auth.secondFactor.setup.start", "command", { require: "authenticated" }],
    ["auth.secondFactor.setup.confirm", "command", { require: "authenticated" }],
    ["auth.secondFactor.verify", "command", { require: "authenticated" }],
    ["auth.secondFactor.recoveryCodes.replace", "command", { require: "authenticated" }],
    ["auth.secondFactor.remove", "command", { require: "authenticated" }]
  ]);
  assert.equal(actions.some((action) => action.channels.includes("automation")), false, "codes never reach automation");
  for (const action of actions) {
    await action.execute({ code: "123456" }, { requestMeta: { request } });
  }
  assert.deepEqual(calls, [
    ["getSecondFactorStatus", request],
    ["startSecondFactorSetup", request],
    ["confirmSecondFactorSetup", request, { code: "123456" }],
    ["verifySecondFactor", request, { code: "123456" }],
    ["replaceSecondFactorRecoveryCodes", request, { code: "123456" }],
    ["removeSecondFactor", request, { code: "123456" }]
  ]);
});

test("AuthFeature contributes actions only when auth.service exists", async () => {
  let actions = null;
  const SelectedAuthProvider = defineProvider({
    id: "test.auth.service",
    provides: { service: "auth.service" },
    setup() {
      return {
        service: {
          async authenticateRequest() {
            return { authenticated: false, actor: null, transientFailure: false };
          },
          async logout() {
            return { ok: true, clearSession: true };
          }
        }
      };
    }
  });
  const ProbeProvider = defineProvider({
    id: "test.auth.actions.probe",
    requires: { catalogue: "runtime.actions" },
    setup({ catalogue }) {
      actions = catalogue;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, SelectedAuthProvider, AuthFeature, ProbeProvider]
  });
  await runtime.start();
  assert.equal(actions.listDefinitions().some((definition) => definition.id === "auth.login.password"), true);
  assert.equal(actions.listDefinitions().some((definition) => definition.id === "auth.secondFactor.verify"), true);
  assert.deepEqual(actions.getDefinition("auth.session.read").surfaces, ["*"]);

  let publicActions = null;
  const EmptyProbe = defineProvider({
    id: "test.auth.empty-probe",
    requires: { catalogue: "runtime.actions" },
    setup({ catalogue }) {
      publicActions = catalogue;
      return {};
    }
  });
  const noAuthRuntime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [EventProvider, ActionProvider, AuthFeature, EmptyProbe]
  });
  await noAuthRuntime.start();
  assert.deepEqual(publicActions.listDefinitions(), []);
});
