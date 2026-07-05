import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAuthCapabilities,
  getCapabilityFeature,
  isAuthOperationSupported
} from "../src/shared/authCapabilities.js";
import {
  buildSecurityStatusFromAuthMethodsStatus,
  normalizeAuthSecurityStatus
} from "../src/shared/authSecurityStatus.js";
import {
  buildLegacyProfileFromActor,
  normalizeAuthActor,
  normalizeAuthResult
} from "../src/server/authActor.js";
import {
  AUTH_OPERATION_UNSUPPORTED_CODE,
  createUnsupportedAuthOperationError,
  isUnsupportedAuthOperationError
} from "../src/server/unsupportedOperation.js";

test("normalizeAuthCapabilities returns one provider-neutral feature shape", () => {
  const capabilities = normalizeAuthCapabilities({
    provider: {
      id: "LOCAL",
      label: ""
    },
    features: {
      password: {
        login: true,
        register: true,
        change: true
      },
      passwordRecovery: {
        request: true,
        complete: true,
        delivery: "smtp"
      },
      oauthLogin: {
        enabled: true,
        providers: [
          { id: "Google", label: "Google" },
          "github",
          "bad provider"
        ],
        defaultProvider: "github"
      },
      providerLinking: {
        start: true
      },
      securityStatus: true
    }
  });

  assert.equal(capabilities.provider.id, "local");
  assert.equal(capabilities.provider.label, "Local");
  assert.equal(capabilities.features.password.login, true);
  assert.equal(capabilities.features.password.methodToggle, false);
  assert.equal(capabilities.features.passwordRecovery.delivery, "smtp");
  assert.deepEqual(capabilities.features.oauthLogin.providers, [
    { id: "google", label: "Google" },
    { id: "github", label: "github" }
  ]);
  assert.equal(capabilities.features.oauthLogin.defaultProvider, "github");
  assert.equal(getCapabilityFeature(capabilities, "providerLinking.start"), true);
  assert.equal(isAuthOperationSupported(capabilities, "startProviderLink"), true);
  assert.equal(isAuthOperationSupported(capabilities, "unlinkProvider"), false);
  assert.equal(isAuthOperationSupported(capabilities, "resetPassword"), true);
  assert.equal(
    isAuthOperationSupported(
      {
        features: {
          password: {
            change: true
          },
          passwordRecovery: {
            complete: false
          }
        }
      },
      "resetPassword"
    ),
    false
  );
});

test("normalizeAuthActor builds the stable actor and legacy profile bridge", () => {
  const actor = normalizeAuthActor({
    authProvider: "supabase",
    authProviderUserSid: "abc-123",
    email: " ADA@example.COM ",
    displayName: "Ada",
    appUserId: 42,
    profileSource: "users"
  });

  assert.deepEqual(actor, {
    authIdentityId: "supabase:abc-123",
    provider: "supabase",
    providerUserId: "abc-123",
    email: "ada@example.com",
    displayName: "Ada",
    appUserId: "42",
    profileSource: "users"
  });
  assert.deepEqual(buildLegacyProfileFromActor(actor), {
    id: "42",
    email: "ada@example.com",
    displayName: "Ada",
    authProvider: "supabase",
    authProviderUserSid: "abc-123"
  });
  assert.deepEqual(normalizeAuthResult({ authenticated: true, actor }).profile, buildLegacyProfileFromActor(actor));
});

test("normalizeAuthActor preserves opaque app user ids", () => {
  const actor = normalizeAuthActor({
    provider: "local",
    providerUserId: "provider-user-1",
    email: "local@example.com",
    appUserId: "app-user-1",
    profileSource: "users"
  });

  assert.equal(actor.appUserId, "app-user-1");
  assert.equal(buildLegacyProfileFromActor(actor).id, "app-user-1");
});

test("normalizeAuthSecurityStatus emits policy and legacy authPolicy aliases", () => {
  const status = buildSecurityStatusFromAuthMethodsStatus(
    {
      methods: [
        {
          id: "password",
          kind: "password",
          configured: true,
          enabled: true,
          canDisable: false
        }
      ],
      minimumEnabledMethods: 1,
      enabledMethodsCount: 1
    },
    {
      actions: {
        changePassword: true,
        signOutOtherSessions: true
      }
    }
  );

  assert.deepEqual(status.policy, {
    minimumEnabledMethods: 1,
    enabledMethodsCount: 1
  });
  assert.equal(status.authPolicy, status.policy);
  assert.equal(status.actions.changePassword, true);
  assert.equal(status.actions.linkProvider, false);
  assert.deepEqual(normalizeAuthSecurityStatus(status), status);
});

test("unsupported auth operation errors are stable AppErrors", () => {
  const error = createUnsupportedAuthOperationError("oauthStart");
  assert.equal(error.status, 501);
  assert.equal(error.code, AUTH_OPERATION_UNSUPPORTED_CODE);
  assert.deepEqual(error.details, {
    operation: "oauthStart"
  });
  assert.equal(isUnsupportedAuthOperationError(error), true);
});
