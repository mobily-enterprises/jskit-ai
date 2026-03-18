import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService } from "../lib/service.js";
import { createStandaloneProfileSyncService } from "../lib/standaloneProfileSyncService.js";
import { createAuthSessionEventsService } from "../lib/authSessionEventsService.js";
import { authActions } from "../lib/actions/auth.contributor.js";

const AUTH_SESSION_EVENTS_SERVICE_TOKEN = "auth.session.events.service";
const AUTH_SESSION_CHANGED_EVENT = "auth.session.changed";
const USERS_BOOTSTRAP_CHANGED_EVENT = "users.bootstrap.changed";
const AUTH_PROFILE_MODE_STANDALONE = "standalone";
const AUTH_PROFILE_MODE_USERS = "users";
const SUPPORTED_AUTH_PROFILE_MODES = Object.freeze([AUTH_PROFILE_MODE_STANDALONE, AUTH_PROFILE_MODE_USERS]);

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveAuthProviderConfig(env) {
  const source = env && typeof env === "object" ? env : {};
  return {
    id: "supabase",
    supabaseUrl: String(source.AUTH_SUPABASE_URL || source.SUPABASE_URL || "").trim(),
    supabasePublishableKey: String(
      source.AUTH_SUPABASE_PUBLISHABLE_KEY || source.SUPABASE_PUBLISHABLE_KEY || ""
    ).trim(),
    jwtAudience: String(source.AUTH_JWT_AUDIENCE || "authenticated").trim(),
    oauthProviders: splitCsv(source.AUTH_OAUTH_PROVIDERS),
    oauthDefaultProvider: String(source.AUTH_OAUTH_DEFAULT_PROVIDER || "").trim()
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

function createInMemoryUserSettingsRepository() {
  const settingsByUserId = new Map();

  function ensure(userId) {
    const numericUserId = Number(userId);
    if (!settingsByUserId.has(numericUserId)) {
      settingsByUserId.set(numericUserId, {
        userId: numericUserId,
        passwordSignInEnabled: true,
        passwordSetupRequired: false
      });
    }
    return settingsByUserId.get(numericUserId);
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
  if (scope.has(KERNEL_TOKENS.Env)) {
    dependencies.env = scope.make(KERNEL_TOKENS.Env);
  }
  if (scope.has(KERNEL_TOKENS.Logger)) {
    dependencies.logger = scope.make(KERNEL_TOKENS.Logger);
  }
  return dependencies;
}

function resolveOptionalRepositories(scope) {
  const repositories = {};
  if (scope.has("userSettingsRepository")) {
    repositories.userSettingsRepository = scope.make("userSettingsRepository");
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
        const dependencies = resolveCommonDependencies(scope);
        const envFromDependencies =
          dependencies?.env && typeof dependencies.env === "object" ? dependencies.env : {};
        const env = {
          ...process.env,
          ...envFromDependencies
        };
        const authProvider = resolveAuthProviderConfig(env);
        const repositories = resolveOptionalRepositories(scope);
        const userSettingsRepository = repositories.userSettingsRepository || fallbackUserSettingsRepository;
        if (!authProvider.supabaseUrl || !authProvider.supabasePublishableKey) {
          return null;
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
          nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
          userSettingsRepository,
          userProfileSyncService
        });
      });
    }

    app.service(
      AUTH_SESSION_EVENTS_SERVICE_TOKEN,
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
                event: AUTH_SESSION_CHANGED_EVENT,
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
                event: USERS_BOOTSTRAP_CHANGED_EVENT,
                audience: "actor_user"
              }
            }
          ]
        }
      }
    );

    app.actions(
      withActionDefaults(authActions, {
        domain: "auth",
        dependencies: {
          authService: "authService",
          authSessionEventsService: AUTH_SESSION_EVENTS_SERVICE_TOKEN
        }
      })
    );
  }
}

export { AuthSupabaseServiceProvider };
