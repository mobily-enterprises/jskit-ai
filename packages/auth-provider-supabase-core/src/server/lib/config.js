import { assertDevAuthPolicy } from "@jskit-ai/auth-core/server/devAuth";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveAllowedOriginsFromSurfaceDefinitions } from "@jskit-ai/kernel/shared/support/returnToPath";
import { buildOtpLoginRedirectUrl, buildPasswordResetRedirectUrl } from "./authRedirectUrls.js";
import { resolveDevAuthConfig } from "./devAuthBootstrap.js";
import { buildOAuthProviderCatalogResponse, resolveSupabaseOAuthProviderCatalog } from "./oauthProviderCatalog.js";

const PROFILE_MODES = Object.freeze(["provider", "users"]);
const DEFAULT_JWT_AUDIENCE = "authenticated";

function splitCsv(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

/** The OAuth providers the app offers: AUTH_OAUTH_PROVIDERS, else config.auth.oauth. */
function resolveOAuthCatalog(env, auth) {
  const oauth = normalizeObject(auth.oauth);
  const envProviders = splitCsv(env.AUTH_OAUTH_PROVIDERS);
  const configuredProviders = Array.isArray(oauth.providers)
    ? oauth.providers.map((entry) => String(entry || "").trim()).filter(Boolean)
    : splitCsv(oauth.providers);
  return resolveSupabaseOAuthProviderCatalog({
    oauthProviders: envProviders.length > 0 ? envProviders : configuredProviders,
    oauthDefaultProvider: String(env.AUTH_OAUTH_DEFAULT_PROVIDER || "").trim() || String(oauth.defaultProvider || "").trim(),
    oauthProviderQueryParams: normalizeObject(oauth.queryParams)
  });
}

function resolveProfileMode(auth) {
  const mode = String(auth.profileMode || "provider").trim().toLowerCase();
  if (!PROFILE_MODES.includes(mode)) {
    throw new Error(`Unsupported config.auth.profileMode "${mode}". Supported values: ${PROFILE_MODES.join(", ")}.`);
  }
  return mode;
}

/**
 * Refuses an AUTH_PROVIDER that names another provider than this installed one.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
function assertSelectedProvider(env) {
  const selected = String(env.AUTH_PROVIDER || "").trim().toLowerCase();
  if (selected && selected !== "supabase") {
    throw new Error(`AUTH_PROVIDER is "${selected}", but the installed auth provider is Supabase.`);
  }
}

/**
 * Supabase auth's settings, read once from the app's config and Env: the
 * project, where profiles live, the app's addresses, its OAuth providers and
 * dev auth.
 * @param {object} sources
 * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} sources.config
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} sources.env
 */
function resolveSupabaseConfig({ config, env }) {
  const auth = normalizeObject(config.auth);
  const profileMode = resolveProfileMode(auth);
  const supabaseUrl = String(env.AUTH_SUPABASE_URL || env.SUPABASE_URL || "").trim();
  const supabasePublishableKey = String(env.AUTH_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  const jwtAudience = String(env.AUTH_JWT_AUDIENCE || "").trim() || DEFAULT_JWT_AUDIENCE;
  const appPublicUrl = String(env.APP_PUBLIC_URL || "").trim();
  const nodeEnv = String(env.NODE_ENV || "").trim() || "development";
  const oauth = resolveOAuthCatalog(env, auth);
  const devAuth = resolveDevAuthConfig(env, jwtAudience);
  assertDevAuthPolicy(devAuth);
  if (devAuth.enabled && profileMode !== "users") {
    throw new Error('Dev auth signs in as an app user, so AUTH_DEV_BYPASS_ENABLED=true requires config.auth.profileMode "users".');
  }

  return Object.freeze({
    profileMode,
    supabaseUrl,
    supabasePublishableKey,
    configured: Boolean(supabaseUrl && supabasePublishableKey),
    jwtAudience,
    isProduction: nodeEnv === "production",
    appPublicUrl,
    allowedReturnToOrigins: resolveAllowedOriginsFromSurfaceDefinitions(config.surfaceDefinitions || {}, {
      seedOrigins: [appPublicUrl]
    }),
    passwordResetRedirectUrl: buildPasswordResetRedirectUrl({ appPublicUrl }),
    otpLoginRedirectUrl: buildOtpLoginRedirectUrl({ appPublicUrl }),
    oauth,
    oauthCatalog: Object.freeze(buildOAuthProviderCatalogResponse(oauth)),
    devAuth
  });
}

export { assertSelectedProvider, resolveSupabaseConfig };
