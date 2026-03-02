function hasNonEmptyEnvValue(value) {
  return String(value || "").trim().length > 0;
}

function resolveAuthProviderId(env) {
  return (
    String(env?.AUTH_PROVIDER || "")
      .trim()
      .toLowerCase() || "supabase"
  );
}

function resolveSupabaseAuthUrl(env) {
  return String(env?.AUTH_SUPABASE_URL || "").trim();
}

function resolveAuthJwtAudience(env) {
  return String(env?.AUTH_JWT_AUDIENCE || "authenticated").trim();
}

function assertEnabledSubsystemStartupPreflight({ env, aiPolicyConfig, billingPolicyConfig, socialPolicyConfig }) {
  const runtimeEnv = env && typeof env === "object" ? env : {};
  const aiPolicy = aiPolicyConfig && typeof aiPolicyConfig === "object" ? aiPolicyConfig : {};
  const billingPolicy = billingPolicyConfig && typeof billingPolicyConfig === "object" ? billingPolicyConfig : {};
  const socialPolicy = socialPolicyConfig && typeof socialPolicyConfig === "object" ? socialPolicyConfig : {};

  const issues = [];
  const hints = [];

  if (aiPolicy.enabled === true && !hasNonEmptyEnvValue(runtimeEnv.AI_API_KEY)) {
    issues.push("AI_API_KEY is required when AI is enabled in config/ai.js.");
    hints.push("Disable AI in config/ai.js (ai.enabled = false) if you are not using it yet.");
  }

  if (billingPolicy.enabled === true) {
    const provider = String(billingPolicy.provider || "")
      .trim()
      .toLowerCase();

    if (!hasNonEmptyEnvValue(runtimeEnv.APP_PUBLIC_URL)) {
      issues.push("APP_PUBLIC_URL is required.");
    }
    if (!hasNonEmptyEnvValue(runtimeEnv.BILLING_OPERATION_KEY_SECRET)) {
      issues.push("operationKeySecret is required (set BILLING_OPERATION_KEY_SECRET).");
    }
    if (!hasNonEmptyEnvValue(runtimeEnv.BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET)) {
      issues.push("providerIdempotencyKeySecret is required (set BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET).");
    }

    if (provider === "stripe") {
      if (!hasNonEmptyEnvValue(runtimeEnv.BILLING_STRIPE_SECRET_KEY)) {
        issues.push("BILLING_STRIPE_SECRET_KEY is required when billing is enabled in config/billing.js.");
      }
      if (!hasNonEmptyEnvValue(runtimeEnv.BILLING_STRIPE_API_VERSION)) {
        issues.push("BILLING_STRIPE_API_VERSION is required when billing is enabled in config/billing.js.");
      }
      if (!hasNonEmptyEnvValue(runtimeEnv.BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET)) {
        issues.push("BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET is required when billing is enabled in config/billing.js.");
      }
    } else if (provider === "paddle") {
      if (!hasNonEmptyEnvValue(runtimeEnv.BILLING_PADDLE_API_KEY)) {
        issues.push("BILLING_PADDLE_API_KEY is required when billing is enabled in config/billing.js.");
      }
      if (!hasNonEmptyEnvValue(runtimeEnv.BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET)) {
        issues.push("BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET is required when billing is enabled in config/billing.js.");
      }
    }

    hints.push("Disable billing in config/billing.js (billing.enabled = false) if you are not using it yet.");
  }

  if (socialPolicy.enabled === true && socialPolicy.federationEnabled === true) {
    if (!hasNonEmptyEnvValue(runtimeEnv.APP_PUBLIC_URL)) {
      issues.push("APP_PUBLIC_URL is required when social federation is enabled in config/social.js.");
    }
    if (!hasNonEmptyEnvValue(runtimeEnv.SOCIAL_FEDERATION_SIGNING_SECRET)) {
      issues.push("SOCIAL_FEDERATION_SIGNING_SECRET is required when social federation is enabled.");
    }

    hints.push(
      "Disable social federation in config/social.js (social.federationEnabled = false) if you are not using federation yet."
    );
  }

  if (issues.length < 1) {
    return;
  }

  const uniqueHints = [...new Set(hints)];
  const hintBlock = uniqueHints.length > 0 ? `\nHints:\n- ${uniqueHints.join("\n- ")}` : "";
  throw new Error(`Startup configuration preflight failed:\n- ${issues.join("\n- ")}${hintBlock}`);
}

export {
  hasNonEmptyEnvValue,
  resolveAuthProviderId,
  resolveSupabaseAuthUrl,
  resolveAuthJwtAudience,
  assertEnabledSubsystemStartupPreflight
};
