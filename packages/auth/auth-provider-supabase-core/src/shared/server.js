import { createService } from "./service.js";
import { createAuthActionContributor } from "./actions/auth.contributor.js";
import {
  createActionRegistry,
  createPermissionEvaluator,
  createNoopIdempotencyAdapter,
  createNoopAuditAdapter,
  createNoopObservabilityAdapter
} from "@jskit-ai/action-runtime-core";

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

function createInMemoryUserProfilesRepository() {
  const profileByKey = new Map();
  const providerKeyByEmail = new Map();
  let nextId = 1;

  function profileKey(provider, providerUserId) {
    return `${String(provider || "").trim().toLowerCase()}:${String(providerUserId || "").trim()}`;
  }

  function cloneProfile(profile) {
    return profile ? { ...profile } : null;
  }

  return Object.freeze({
    async findByIdentity({ provider, providerUserId } = {}) {
      return cloneProfile(profileByKey.get(profileKey(provider, providerUserId)) || null);
    },
    async upsert({ authProvider, authProviderUserId, email, displayName } = {}) {
      const key = profileKey(authProvider, authProviderUserId);
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const current = profileByKey.get(key) || null;

      const ownedBy = providerKeyByEmail.get(normalizedEmail);
      if (ownedBy && ownedBy !== key) {
        const conflictError = new Error("Profile email conflicts with existing identity.");
        conflictError.code = "USER_PROFILE_EMAIL_CONFLICT";
        throw conflictError;
      }

      const next = {
        id: Number(current?.id || nextId++),
        authProvider: String(authProvider || "").trim().toLowerCase(),
        authProviderUserId: String(authProviderUserId || "").trim(),
        email: String(email || "").trim().toLowerCase(),
        displayName: String(displayName || "").trim() || String(email || "").trim().toLowerCase()
      };
      profileByKey.set(key, next);
      providerKeyByEmail.set(next.email, key);
      return cloneProfile(next);
    }
  });
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

function createServerContributions() {
  const fallbackProfilesRepository = createInMemoryUserProfilesRepository();
  const fallbackUserSettingsRepository = createInMemoryUserSettingsRepository();

  return {
    repositories: [],
    services: [
      {
        id: "authService",
        create({ repositories = {}, dependencies = {} } = {}) {
          const envFromDependencies =
            dependencies?.env && typeof dependencies.env === "object" ? dependencies.env : {};
          const env = {
            ...process.env,
            ...envFromDependencies
          };
          const authProvider = resolveAuthProviderConfig(env);
          const userProfilesRepository = repositories.userProfilesRepository || fallbackProfilesRepository;
          const userSettingsRepository = repositories.userSettingsRepository || fallbackUserSettingsRepository;
          if (!authProvider.supabaseUrl || !authProvider.supabasePublishableKey) {
            return null;
          }

          return createService({
            authProvider,
            appPublicUrl: String(env.APP_PUBLIC_URL || "").trim(),
            nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
            userProfilesRepository,
            userSettingsRepository
          });
        }
      },
      {
        id: "actionRegistry",
        create({ services = {}, dependencies = {} } = {}) {
          if (!services.authService) {
            return null;
          }

          const contributors = [];
          try {
            contributors.push(
              createAuthActionContributor({
                authService: services.authService
              })
            );
          } catch {
            return null;
          }

          return createActionRegistry({
            contributors,
            permissionEvaluator: createPermissionEvaluator(),
            idempotencyAdapter: createNoopIdempotencyAdapter(),
            auditAdapter: createNoopAuditAdapter(),
            observabilityAdapter: createNoopObservabilityAdapter(),
            logger: dependencies?.logger || console
          });
        }
      },
      {
        id: "actionExecutor",
        create({ services = {} } = {}) {
          if (!services.actionRegistry) {
            return null;
          }
          return {
            execute(payload) {
              return services.actionRegistry.execute(payload);
            },
            executeStream(payload) {
              return services.actionRegistry.executeStream(payload);
            },
            listDefinitions() {
              return services.actionRegistry.listDefinitions();
            },
            getDefinition(actionId, version = null) {
              return services.actionRegistry.getDefinition(actionId, version);
            }
          };
        }
      }
    ],
    controllers: [],
    routes: [],
    actions: [],
    plugins: [],
    workers: [],
    lifecycle: []
  };
}

export { createServerContributions };
