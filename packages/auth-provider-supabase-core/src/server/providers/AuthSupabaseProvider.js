import {
  attachDeferredAuthService,
  createDeferredAuthService
} from "@jskit-ai/auth-core/server/deferredAuthService";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { resolveAllowedOriginsFromSurfaceDefinitions } from "@jskit-ai/kernel/shared/support/returnToPath";
import { createService } from "../lib/service.js";

const PROFILE_MODES = Object.freeze(["provider", "users"]);

function normalizeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function splitCsv(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function oauthConfig(config) {
  const oauth = normalizeRecord(normalizeRecord(config.auth).oauth);
  return {
    providers: Array.isArray(oauth.providers)
      ? oauth.providers.map((entry) => String(entry || "").trim()).filter(Boolean)
      : splitCsv(oauth.providers),
    defaultProvider: String(oauth.defaultProvider || "").trim()
  };
}

function providerConfig(env, config) {
  const configuredOauth = oauthConfig(config);
  const envProviders = splitCsv(env.AUTH_OAUTH_PROVIDERS);
  return {
    id: "supabase",
    supabaseUrl: String(env.AUTH_SUPABASE_URL || env.SUPABASE_URL || "").trim(),
    supabasePublishableKey: String(
      env.AUTH_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || ""
    ).trim(),
    jwtAudience: String(env.AUTH_JWT_AUDIENCE || "authenticated").trim(),
    oauthProviders: envProviders.length > 0 ? envProviders : configuredOauth.providers,
    oauthDefaultProvider: String(env.AUTH_OAUTH_DEFAULT_PROVIDER || "").trim() || configuredOauth.defaultProvider
  };
}

function profileMode(config) {
  const mode = String(normalizeRecord(config.auth).profileMode || "provider").trim().toLowerCase();
  if (!PROFILE_MODES.includes(mode)) {
    throw new Error(`Unsupported config.auth.profileMode "${mode}". Supported values: ${PROFILE_MODES.join(", ")}.`);
  }
  return mode;
}

function createProviderProfileProjector() {
  return Object.freeze({
    async findByIdentity() { return null; },
    async syncIdentityProfile(profileLike) {
      const profile = normalizeRecord(profileLike);
      const authProviderUserSid = String(profile.authProviderUserSid || "").trim();
      const email = normalizeEmail(profile.email || "");
      if (!authProviderUserSid || !email) {
        throw new TypeError("Provider identity profile requires authProviderUserSid and email.");
      }
      return {
        id: authProviderUserSid,
        authProvider: String(profile.authProvider || "supabase").trim() || "supabase",
        authProviderUserSid,
        email,
        displayName: String(profile.displayName || email.split("@")[0] || "User").trim(),
        profileSource: "auth-provider"
      };
    }
  });
}

function assertSelectedProvider(env) {
  const selected = String(env.AUTH_PROVIDER || "").trim().toLowerCase();
  if (selected && selected !== "supabase") {
    throw new Error(`AUTH_PROVIDER is "${selected}", but the installed auth provider is Supabase.`);
  }
}

const AuthSupabaseProvider = defineProvider({
  id: "auth.supabase",
  requires: {
    config: "runtime.config",
    env: "runtime.env",
    extensions: "auth.extensions"
  },
  optional: {
    identity: "users.identity"
  },
  provides: {
    authService: "auth.service"
  },
  setup({ env }) {
    assertSelectedProvider(env);
    return { authService: createDeferredAuthService() };
  },
  boot({ config, env, extensions, identity }, { outputs }) {
    assertSelectedProvider(env);
    const mode = profileMode(config);
    if (mode === "users" && !identity) {
      throw new Error('Supabase auth profileMode "users" requires the users.identity capability.');
    }
    const projector = mode === "users" ? identity.profileProjector : createProviderProfileProjector();
    const appPublicUrl = String(env.APP_PUBLIC_URL || "").trim();
    const baseService = createService({
      authProvider: providerConfig(env, config),
      appPublicUrl,
      authAllowedReturnToOrigins: resolveAllowedOriginsFromSurfaceDefinitions(config.surfaceDefinitions || {}, {
        seedOrigins: [appPublicUrl]
      }),
      nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
      userSettingsRepository: mode === "users" ? identity.repositories.userSettings : null,
      userProfilesRepository: mode === "users" ? identity.repositories.userProfiles : null,
      userProfileSyncService: projector,
      profileProjectionEnabled: mode === "users",
      devAuthBypassEnabled: env.AUTH_DEV_BYPASS_ENABLED,
      devAuthBypassSecret: String(env.AUTH_DEV_BYPASS_SECRET || "").trim(),
      devAuthAccessTtlSeconds: env.AUTH_DEV_ACCESS_TTL_SECONDS,
      devAuthRefreshTtlSeconds: env.AUTH_DEV_REFRESH_TTL_SECONDS
    });
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
  }
});

export { AuthSupabaseProvider };
