import assert from "node:assert/strict";
import test from "node:test";

import {
  hasNonEmptyEnvValue,
  resolveAuthProviderId,
  resolveSupabaseAuthUrl,
  resolveAuthJwtAudience,
  assertEnabledSubsystemStartupPreflight
} from "../src/shared/startupPreflight.js";

test("startupPreflight helpers normalize auth env values", () => {
  assert.equal(hasNonEmptyEnvValue(" x "), true);
  assert.equal(hasNonEmptyEnvValue(" "), false);

  assert.equal(resolveAuthProviderId({ AUTH_PROVIDER: " SUPABASE " }), "supabase");
  assert.equal(resolveAuthProviderId({ AUTH_PROVIDER: "" }), "supabase");
  assert.equal(resolveAuthProviderId({}), "supabase");

  assert.equal(resolveSupabaseAuthUrl({ AUTH_SUPABASE_URL: " https://supabase.example.test " }), "https://supabase.example.test");
  assert.equal(resolveSupabaseAuthUrl({ AUTH_SUPABASE_URL: "" }), "");

  assert.equal(resolveAuthJwtAudience({ AUTH_JWT_AUDIENCE: " team " }), "team");
  assert.equal(resolveAuthJwtAudience({ AUTH_JWT_AUDIENCE: "" }), "authenticated");
  assert.equal(resolveAuthJwtAudience({}), "authenticated");
});

test("assertEnabledSubsystemStartupPreflight throws for missing enabled subsystem secrets", () => {
  assert.throws(
    () =>
      assertEnabledSubsystemStartupPreflight({
        env: {},
        aiPolicyConfig: {
          enabled: true
        },
        billingPolicyConfig: {
          enabled: false
        },
        socialPolicyConfig: {
          enabled: false
        }
      }),
    /AI_API_KEY is required/
  );

  assert.throws(
    () =>
      assertEnabledSubsystemStartupPreflight({
        env: {
          APP_PUBLIC_URL: "https://app.example.test",
          BILLING_OPERATION_KEY_SECRET: "",
          BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "",
          BILLING_STRIPE_SECRET_KEY: "",
          BILLING_STRIPE_API_VERSION: "",
          BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: ""
        },
        aiPolicyConfig: {
          enabled: false
        },
        billingPolicyConfig: {
          enabled: true,
          provider: "stripe"
        },
        socialPolicyConfig: {
          enabled: false
        }
      }),
    /BILLING_STRIPE_SECRET_KEY is required/
  );

  assert.throws(
    () =>
      assertEnabledSubsystemStartupPreflight({
        env: {
          APP_PUBLIC_URL: "",
          SOCIAL_FEDERATION_SIGNING_SECRET: ""
        },
        aiPolicyConfig: {
          enabled: false
        },
        billingPolicyConfig: {
          enabled: false
        },
        socialPolicyConfig: {
          enabled: true,
          federationEnabled: true
        }
      }),
    /SOCIAL_FEDERATION_SIGNING_SECRET is required/
  );
});

test("assertEnabledSubsystemStartupPreflight allows disabled subsystems and provider-scoped secrets", () => {
  assert.doesNotThrow(() =>
    assertEnabledSubsystemStartupPreflight({
      env: {},
      aiPolicyConfig: {
        enabled: false
      },
      billingPolicyConfig: {
        enabled: false
      },
      socialPolicyConfig: {
        enabled: false,
        federationEnabled: true
      }
    })
  );

  assert.doesNotThrow(() =>
    assertEnabledSubsystemStartupPreflight({
      env: {
        APP_PUBLIC_URL: "https://app.example.test",
        BILLING_OPERATION_KEY_SECRET: "op_secret",
        BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "idem_secret",
        BILLING_STRIPE_SECRET_KEY: "sk_test_123",
        BILLING_STRIPE_API_VERSION: "2024-06-20",
        BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: "whsec_stripe_test",
        BILLING_PADDLE_API_KEY: "",
        BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET: ""
      },
      aiPolicyConfig: {
        enabled: false
      },
      billingPolicyConfig: {
        enabled: true,
        provider: "stripe"
      },
      socialPolicyConfig: {
        enabled: false
      }
    })
  );

  assert.doesNotThrow(() =>
    assertEnabledSubsystemStartupPreflight({
      env: {
        APP_PUBLIC_URL: "https://app.example.test",
        BILLING_OPERATION_KEY_SECRET: "op_secret",
        BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "idem_secret",
        BILLING_PADDLE_API_KEY: "pdl_key",
        BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET: "pdl_secret",
        BILLING_STRIPE_SECRET_KEY: "",
        BILLING_STRIPE_API_VERSION: "",
        BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: ""
      },
      aiPolicyConfig: {
        enabled: false
      },
      billingPolicyConfig: {
        enabled: true,
        provider: "paddle"
      },
      socialPolicyConfig: {
        enabled: false
      }
    })
  );
});
