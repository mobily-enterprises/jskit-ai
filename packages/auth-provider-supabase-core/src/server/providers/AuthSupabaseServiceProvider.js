import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { createService } from "../lib/service.js";
import { createAuthActionContributor } from "../lib/actions/auth.contributor.js";
import { registerActionContributor } from "@jskit-ai/action-runtime-core/server";

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

const fallbackProfilesRepository = createInMemoryUserProfilesRepository();
const fallbackUserSettingsRepository = createInMemoryUserSettingsRepository();

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
  if (scope.has("userProfilesRepository")) {
    repositories.userProfilesRepository = scope.make("userProfilesRepository");
  }
  if (scope.has("userSettingsRepository")) {
    repositories.userSettingsRepository = scope.make("userSettingsRepository");
  }
  return repositories;
}

class AuthSupabaseServiceProvider {
  static id = "auth.provider.supabase";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function" || typeof app.tag !== "function") {
      throw new Error("AuthSupabaseServiceProvider requires application singleton()/has()/tag().");
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
      });
    }

    const contributorToken = "auth.provider.supabase.actionContributor";
    if (!app.has(contributorToken)) {
      registerActionContributor(app, contributorToken, (scope) => {
        const authService = scope.make("authService");
        if (!authService) {
          return null;
        }

        try {
          return createAuthActionContributor({
            authService
          });
        } catch {
          return null;
        }
      });
    }
  }
}

export { AuthSupabaseServiceProvider };
