import { resolveAllowedOriginsFromSurfaceDefinitions } from "@jskit-ai/kernel/shared/support/returnToPath";
import { applyAuthServiceDecorators } from "@jskit-ai/auth-core/server/authServiceDecoratorRegistry";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { createService } from "../lib/service.js";

const PROFILE_MODE_PROVIDER = "provider";
const PROFILE_MODE_STANDALONE = "standalone";
const PROFILE_MODE_USERS = "users";
const SUPPORTED_PROFILE_MODES = Object.freeze([PROFILE_MODE_PROVIDER, PROFILE_MODE_STANDALONE, PROFILE_MODE_USERS]);
const INTERNAL_JSON_REST_API = "internal.json-rest-api";

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeOAuthProviderConfigList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return splitCsv(value);
  }

  return [];
}

function resolveOAuthConfigFromAppConfig(appConfig) {
  const source = normalizeRecord(appConfig);
  const auth = normalizeRecord(source.auth);
  const oauth = normalizeRecord(auth.oauth);

  return {
    oauthProviders: normalizeOAuthProviderConfigList(oauth.providers),
    oauthDefaultProvider: String(oauth.defaultProvider || "").trim()
  };
}

function resolveAllowedReturnToOrigins({ appConfig = {}, appPublicUrl = "" } = {}) {
  const surfaceDefinitions =
    appConfig && typeof appConfig === "object" && appConfig.surfaceDefinitions && typeof appConfig.surfaceDefinitions === "object"
      ? appConfig.surfaceDefinitions
      : {};

  return resolveAllowedOriginsFromSurfaceDefinitions(surfaceDefinitions, {
    seedOrigins: [appPublicUrl]
  });
}

function resolveAuthProviderConfig(env, appConfig = {}) {
  const source = env && typeof env === "object" ? env : {};
  const oauthConfigFromApp = resolveOAuthConfigFromAppConfig(appConfig);
  const oauthProvidersFromEnv = splitCsv(source.AUTH_OAUTH_PROVIDERS);
  const oauthDefaultProviderFromEnv = String(source.AUTH_OAUTH_DEFAULT_PROVIDER || "").trim();

  return {
    id: "supabase",
    supabaseUrl: String(source.AUTH_SUPABASE_URL || source.SUPABASE_URL || "").trim(),
    supabasePublishableKey: String(
      source.AUTH_SUPABASE_PUBLISHABLE_KEY || source.SUPABASE_PUBLISHABLE_KEY || ""
    ).trim(),
    jwtAudience: String(source.AUTH_JWT_AUDIENCE || "authenticated").trim(),
    oauthProviders:
      oauthProvidersFromEnv.length > 0 ? oauthProvidersFromEnv : oauthConfigFromApp.oauthProviders,
    oauthDefaultProvider: oauthDefaultProviderFromEnv || oauthConfigFromApp.oauthDefaultProvider
  };
}

function resolveAuthProfileMode(appConfig = {}) {
  const auth = normalizeRecord(normalizeRecord(appConfig).auth);
  const mode = String(auth.profileMode || PROFILE_MODE_PROVIDER)
    .trim()
    .toLowerCase();
  if (SUPPORTED_PROFILE_MODES.includes(mode)) {
    return mode === PROFILE_MODE_STANDALONE ? PROFILE_MODE_PROVIDER : mode;
  }
  throw new Error(
    `Unsupported config.auth.profileMode "${mode}". Supported values: ${SUPPORTED_PROFILE_MODES.join(", ")}.`
  );
}

function createProviderIdentityProfileSyncService({ authProviderId = "supabase" } = {}) {
  return Object.freeze({
    async findByIdentity() {
      return null;
    },
    async syncIdentityProfile(profileLike) {
      const source = normalizeRecord(profileLike);
      const authProvider = String(source.authProvider || authProviderId).trim() || authProviderId;
      const authProviderUserSid = String(source.authProviderUserSid || "").trim();
      const email = normalizeEmail(source.email || "");
      const displayName = String(source.displayName || email.split("@")[0] || "User").trim();
      if (!authProviderUserSid || !email) {
        throw new TypeError("Provider identity profile requires authProviderUserSid and email.");
      }
      return {
        id: authProviderUserSid,
        authProvider,
        authProviderUserSid,
        email,
        displayName,
        profileSource: "auth-provider"
      };
    }
  });
}

function resolveCommonDependencies(scope) {
  const dependencies = {};
  if (scope.has("jskit.env")) {
    dependencies.env = scope.make("jskit.env");
  }
  if (scope.has("jskit.logger")) {
    dependencies.logger = scope.make("jskit.logger");
  }
  return dependencies;
}

function resolveRuntimeEnv(scope) {
  const dependencies = resolveCommonDependencies(scope);
  const envFromDependencies =
    dependencies?.env && typeof dependencies.env === "object" ? dependencies.env : {};

  return {
    ...process.env,
    ...envFromDependencies
  };
}

function assertSelectedAuthProvider(env) {
  const selectedProvider = String(env?.AUTH_PROVIDER || "").trim().toLowerCase();
  if (selectedProvider && selectedProvider !== "supabase") {
    throw new Error(
      `AUTH_PROVIDER is "${selectedProvider}", but @jskit-ai/auth-provider-supabase-core is installed as the selected auth provider.`
    );
  }
}

function resolveOptionalRepositories(scope) {
  const repositories = {};
  if (scope.has("internal.repository.user-settings")) {
    repositories.userSettingsRepository = scope.make("internal.repository.user-settings");
  }
  if (scope.has("internal.repository.user-profiles")) {
    repositories.userProfilesRepository = scope.make("internal.repository.user-profiles");
  }
  return repositories;
}

function isDeferredJsonRestBootGap(app, error) {
  const hasUserProfilesRepository = typeof app?.has === "function" && app.has("internal.repository.user-profiles");
  const hasJsonRestApi = typeof app?.has === "function" && app.has(INTERNAL_JSON_REST_API);
  const message = String(error?.message || "");
  const causeMessage = String(error?.cause?.message || "");
  const combined = `${message}\n${causeMessage}`;

  return (
    hasUserProfilesRepository &&
    !hasJsonRestApi &&
    /internal\.json-rest-api/.test(combined) &&
    /not registered/i.test(combined)
  );
}

class AuthSupabaseServiceProvider {
  static id = "auth.provider.supabase";

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.has !== "function"
    ) {
      throw new Error("AuthSupabaseServiceProvider requires application singleton()/has().");
    }

    assertSelectedAuthProvider(resolveRuntimeEnv(app));

    if (app.has("authService")) {
      throw new Error("AuthSupabaseServiceProvider cannot register authService because another auth provider already registered it.");
    }

    app.singleton("authService", (scope) => {
      const env = resolveRuntimeEnv(scope);
      assertSelectedAuthProvider(env);
      const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
      const authProvider = resolveAuthProviderConfig(env, appConfig);
      const repositories = resolveOptionalRepositories(scope);
      const userSettingsRepository = repositories.userSettingsRepository || null;
      const authProfileMode = resolveAuthProfileMode(appConfig);
      let userProfileSyncService = createProviderIdentityProfileSyncService({
        authProviderId: authProvider.id
      });
      let profileProjectionEnabled = false;
      if (authProfileMode === PROFILE_MODE_USERS) {
        if (!scope.has("users.profile.sync.service")) {
          throw new Error(
            "AuthSupabaseServiceProvider requires users.profile.sync.service when config.auth.profileMode is \"users\"."
          );
        }
        userProfileSyncService = scope.make("users.profile.sync.service");
        profileProjectionEnabled = true;
      } else if (scope.has("auth.profile.projector")) {
        userProfileSyncService = scope.make("auth.profile.projector");
        profileProjectionEnabled = true;
      }

      const authService = createService({
        authProvider,
        appPublicUrl: String(env.APP_PUBLIC_URL || "").trim(),
        authAllowedReturnToOrigins: resolveAllowedReturnToOrigins({
          appConfig,
          appPublicUrl: String(env.APP_PUBLIC_URL || "").trim()
        }),
        nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
        userSettingsRepository,
        userProfileSyncService,
        profileProjectionEnabled,
        userProfilesRepository: repositories.userProfilesRepository || null,
        devAuthBypassEnabled: env.AUTH_DEV_BYPASS_ENABLED,
        devAuthBypassSecret: String(env.AUTH_DEV_BYPASS_SECRET || "").trim(),
        devAuthAccessTtlSeconds: env.AUTH_DEV_ACCESS_TTL_SECONDS,
        devAuthRefreshTtlSeconds: env.AUTH_DEV_REFRESH_TTL_SECONDS
      });

      return applyAuthServiceDecorators(scope, authService);
    });
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthSupabaseServiceProvider requires application make().");
    }

    try {
      app.make("authService");
    } catch (error) {
      // In users mode, repo bindings can exist after register() while the json-rest host
      // token is still unavailable until json-rest-api.core.boot(). Defer eager authService
      // materialization only for that exact lifecycle gap; every other configuration error
      // should still fail fast during boot.
      if (isDeferredJsonRestBootGap(app, error)) {
        return;
      }
      throw error;
    }
  }
}

export { AuthSupabaseServiceProvider };
