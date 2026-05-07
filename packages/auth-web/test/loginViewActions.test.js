import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthOauthStartPath } from "@jskit-ai/auth-core/shared/authPaths";
import { useLoginViewActions } from "../src/client/composables/loginView/useLoginViewActions.js";

function createMinimalLoginViewState(requestedReturnTo = "/") {
  return {
    requestedReturnTo: { value: requestedReturnTo },
    allowedReturnToOrigins: { value: [] },
    errorMessage: { value: "" },
    infoMessage: { value: "" },
    loading: { value: false },
    email: { value: "" },
    password: { value: "" },
    otpCode: { value: "" },
    otpRequestPending: { value: false },
    registerConfirmationResendPending: { value: false },
    pendingEmailConfirmationAddress: { value: "" },
    oauthProviders: { value: [] },
    oauthDefaultProvider: { value: "google" },
    isRegister: { value: false },
    isOtp: { value: false },
    showRememberedAccount: { value: false },
    rememberedAccountDisplayName: { value: "" },
    clearTransientMessages() {},
    applyRememberedAccountPreference() {},
    applyRememberedAccountHint() {},
    enterEmailConfirmationPendingState() {},
    resolveNormalizedEmail() {
      return "ada@example.com";
    }
  };
}

test("useLoginViewActions preserves the intended destination when starting OAuth sign-in", () => {
  const state = createMinimalLoginViewState("/w/acme/workouts/2026-05-07?tab=chart");
  const assignedTargets = [];
  const actions = useLoginViewActions({
    state,
    validation: {},
    queryClient: {},
    errorRuntime: {
      report() {}
    },
    oauthLaunchClient: {
      async open({ url }) {
        assignedTargets.push(url);
      }
    }
  });

  return actions.startOAuthSignIn("google").then(() => {
    const expectedPath = buildAuthOauthStartPath("google");
    assert.deepEqual(assignedTargets, [
      `${expectedPath}?returnTo=%2Fw%2Facme%2Fworkouts%2F2026-05-07%3Ftab%3Dchart`
    ]);
    assert.equal(state.errorMessage.value, "");
  });
});
