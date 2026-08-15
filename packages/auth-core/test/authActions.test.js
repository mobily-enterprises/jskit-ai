import assert from "node:assert/strict";
import test from "node:test";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { buildAuthActions } from "../src/server/actions/auth.contributor.js";
import { AuthFeature } from "../src/server/providers/AuthFeature.js";

test("auth logout action delegates directly to the selected auth service", async () => {
  const calls = [];
  const authService = {
    async logout(request) {
      calls.push(request);
      return { ok: true, clearSession: true };
    }
  };
  const action = buildAuthActions({ authService }).find((definition) => definition.id === "auth.logout");
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
  const action = buildAuthActions({
    authService: {
      async devLoginAs(receivedRequest, receivedInput) {
        received = { input: receivedInput, request: receivedRequest };
        return { ok: true };
      }
    }
  }).find((definition) => definition.id === "auth.dev.loginAs");
  assert.deepEqual(await action.execute(input, { requestMeta: { request } }), { ok: true });
  assert.deepEqual(received, { input, request });
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
    providers: [createActionProvider(), SelectedAuthProvider, AuthFeature, ProbeProvider]
  });
  await runtime.start();
  assert.equal(actions.listDefinitions().some((definition) => definition.id === "auth.login.password"), true);
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
    providers: [createActionProvider(), AuthFeature, EmptyProbe]
  });
  await noAuthRuntime.start();
  assert.deepEqual(publicActions.listDefinitions(), []);
});
