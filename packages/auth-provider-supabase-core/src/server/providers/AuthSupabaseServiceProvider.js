import { resolveAllowedOriginsFromSurfaceDefinitions } from "@jskit-ai/kernel/shared/support/returnToPath";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { createService } from "../lib/service.js";
import { createStandaloneProfileSyncService } from "../lib/standaloneProfileSyncService.js";
import { createAuthSessionEventsService } from "../lib/authSessionEventsService.js";
import { buildAuthActions } from "../lib/actions/auth.contributor.js";
const AUTH_PROFILE_MODE_STANDALONE = "standalone";
const AUTH_PROFILE_MODE_USERS = "users";
const SUPPORTED_AUTH_PROFILE_MODES = Object.freeze([AUTH_PROFILE_MODE_STANDALONE, AUTH_PROFILE_MODE_USERS]);

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
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

function resolveAuthProfileMode(env) {
  const source = env && typeof env === "object" ? env : {};
  const mode = String(source.AUTH_PROFILE_MODE || AUTH_PROFILE_MODE_STANDALONE)
    .trim()
    .toLowerCase();
  if (SUPPORTED_AUTH_PROFILE_MODES.includes(mode)) {
    return mode;
  }
  throw new Error(
    `Unsupported AUTH_PROFILE_MODE "${mode}". Supported values: ${SUPPORTED_AUTH_PROFILE_MODES.join(", ")}.`
  );
}

function isDevAuthBypassEnabledForRegistration(env) {
  if (!isDevAuthBypassRequested(env)) {
    return false;
  }

  return String(env?.NODE_ENV || "development").trim().toLowerCase() !== "production";
}

function isDevAuthBypassRequested(env) {
  return parseBoolean(env?.AUTH_DEV_BYPASS_ENABLED, false);
}

function createInMemoryUserSettingsRepository() {
  const settingsByUserId = new Map();

  function ensure(userId) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      throw new TypeError("User settings require a valid user id.");
    }
    if (!settingsByUserId.has(normalizedUserId)) {
      settingsByUserId.set(normalizedUserId, {
        userId: normalizedUserId,
        passwordSignInEnabled: true,
        passwordSetupRequired: false
      });
    }
    return settingsByUserId.get(normalizedUserId);
  }

  return Object.freeze({
    async ensureForUserId(userId) {
      return { ...ensure(userId) };
    },
    async updatePasswordSignInEnabled(userId, enabled) {
      const settings = ensure(userId);
      settings.passwordSignInEnabled = enabled !== false;
      return { ...settings };
    },
    async updatePasswordSetupRequired(userId, required) {
      const settings = ensure(userId);
      settings.passwordSetupRequired = required === true;
      return { ...settings };
    }
  });
}

const fallbackUserSettingsRepository = createInMemoryUserSettingsRepository();
const fallbackStandaloneProfileSyncService = createStandaloneProfileSyncService();

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

class AuthSupabaseServiceProvider {
  static id = "auth.provider.supabase";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.has !== "function" ||
      typeof app.actions !== "function" ||
      typeof app.service !== "function"
    ) {
      throw new Error("AuthSupabaseServiceProvider requires application singleton()/has()/actions()/service().");
    }

    if (!app.has("authService")) {
      app.singleton("authService", (scope) => {
        const env = resolveRuntimeEnv(scope);
        const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
        const authProvider = resolveAuthProviderConfig(env, appConfig);
        const repositories = resolveOptionalRepositories(scope);
        const userSettingsRepository = repositories.userSettingsRepository || fallbackUserSettingsRepository;
        const devAuthBypassEnabled = parseBoolean(env.AUTH_DEV_BYPASS_ENABLED, false);
        if (!authProvider.supabaseUrl || !authProvider.supabasePublishableKey) {
          if (!devAuthBypassEnabled) {
            return null;
          }
        }
        const authProfileMode = resolveAuthProfileMode(env);
        let userProfileSyncService = fallbackStandaloneProfileSyncService;
        if (authProfileMode === AUTH_PROFILE_MODE_USERS) {
          if (!scope.has("users.profile.sync.service")) {
            throw new Error(
              "AuthSupabaseServiceProvider requires users.profile.sync.service when AUTH_PROFILE_MODE=users."
            );
          }
          userProfileSyncService = scope.make("users.profile.sync.service");
        }

        return createService({
          authProvider,
          appPublicUrl: String(env.APP_PUBLIC_URL || "").trim(),
          authAllowedReturnToOrigins: resolveAllowedReturnToOrigins({
            appConfig,
            appPublicUrl: String(env.APP_PUBLIC_URL || "").trim()
          }),
          nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
          userSettingsRepository,
          userProfileSyncService,
          userProfilesRepository: repositories.userProfilesRepository || null,
          devAuthBypassEnabled,
          devAuthBypassSecret: String(env.AUTH_DEV_BYPASS_SECRET || "").trim(),
          devAuthAccessTtlSeconds: env.AUTH_DEV_ACCESS_TTL_SECONDS,
          devAuthRefreshTtlSeconds: env.AUTH_DEV_REFRESH_TTL_SECONDS
        });
      });
    }

    app.service(
      "auth.session.events.service",
      () => createAuthSessionEventsService(),
      {
        events: {
          notifySessionChanged: [
            {
              type: "entity.changed",
              source: "auth",
              entity: "session",
              operation: "updated",
              entityId: ({ result }) => result?.id,
              realtime: {
                event: "auth.session.changed",
                audience: "actor_user"
              }
            },
            {
              type: "entity.changed",
              source: "users",
              entity: "bootstrap",
              operation: "updated",
              entityId: ({ result }) => result?.id,
              realtime: {
                event: "users.bootstrap.changed",
                audience: "actor_user"
              }
            }
          ]
        }
      }
    );

    app.actions(
      withActionDefaults(buildAuthActions({
        includeDevLoginAs: isDevAuthBypassEnabledForRegistration(resolveRuntimeEnv(app))
      }), {
        domain: "auth",
        dependencies: {
          authService: "authService",
          authSessionEventsService: "auth.session.events.service"
        }
      })
    );
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthSupabaseServiceProvider requires application make().");
    }

    if (!isDevAuthBypassRequested(resolveRuntimeEnv(app))) {
      return;
    }

    app.make("authService");
  }
}

export { AuthSupabaseServiceProvider };
