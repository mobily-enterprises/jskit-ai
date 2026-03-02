import { TOKENS } from "@jskit-ai/framework-core/support/tokens";
import { createService } from "../lib/service.js";
import { createAuthActionContributor } from "../lib/actions/auth.contributor.js";
import {
  createActionRegistry,
  createPermissionEvaluator,
  createNoopIdempotencyAdapter,
  createNoopAuditAdapter,
  createNoopObservabilityAdapter,
  normalizeExecutionContext,
  normalizeText
} from "@jskit-ai/action-runtime-core/server";
import { resolveClientIpAddress } from "@jskit-ai/framework-core/server/requestUrl";

const DEFAULT_SURFACE = "app";
const KNOWN_SURFACES = new Set(["app", "admin", "console"]);

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeOptionalObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function normalizeSurfaceId(value) {
  const candidate = normalizeText(value).toLowerCase();
  return KNOWN_SURFACES.has(candidate) ? candidate : "";
}

function resolveRequestSurface({ request = null, explicitSurface = "" } = {}) {
  const surfaceFromContext = normalizeSurfaceId(explicitSurface);
  if (surfaceFromContext) {
    return surfaceFromContext;
  }

  const headerValue = request?.headers?.["x-surface-id"];
  const surfaceFromHeader = normalizeSurfaceId(Array.isArray(headerValue) ? headerValue[0] : headerValue);
  if (surfaceFromHeader) {
    return surfaceFromHeader;
  }

  return DEFAULT_SURFACE;
}

function resolveRequestMeta({ request = null, requestMeta = {} } = {}) {
  const source = normalizePlainObject(requestMeta);

  const commandHeader = request?.headers?.["x-command-id"];
  const idempotencyHeader = request?.headers?.["idempotency-key"];
  const userAgentHeader = request?.headers?.["user-agent"];

  return {
    requestId: normalizeText(source.requestId || request?.id),
    commandId: normalizeText(source.commandId || (Array.isArray(commandHeader) ? commandHeader[0] : commandHeader)),
    idempotencyKey: normalizeText(
      source.idempotencyKey || (Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader)
    ),
    ip: normalizeText(source.ip || resolveClientIpAddress(request)),
    userAgent: normalizeText(source.userAgent || (Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader)),
    request
  };
}

function buildExecutionContext(context = {}) {
  const source = normalizePlainObject(context);
  const sourceRequestMeta = normalizePlainObject(source.requestMeta);
  const request = source.request || sourceRequestMeta.request || null;

  const actor = normalizeOptionalObject(source.actor) || normalizeOptionalObject(request?.user);
  const workspace = normalizeOptionalObject(source.workspace) || normalizeOptionalObject(request?.workspace);
  const membership = normalizeOptionalObject(source.membership) || normalizeOptionalObject(request?.membership);
  const permissions = Array.isArray(source.permissions)
    ? source.permissions
    : Array.isArray(request?.permissions)
      ? request.permissions
      : [];

  return normalizeExecutionContext({
    actor,
    workspace,
    membership,
    permissions,
    surface: resolveRequestSurface({
      request,
      explicitSurface: source.surface
    }),
    channel: normalizeText(source.channel) || "internal",
    requestMeta: resolveRequestMeta({
      request,
      requestMeta: sourceRequestMeta
    }),
    assistantMeta: normalizePlainObject(source.assistantMeta),
    timeMeta: normalizePlainObject(source.timeMeta)
  });
}

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

function isSupabaseUrl(value) {
  return /^https:\/\/[^\s]+\.supabase\.co\/?$/i.test(String(value || "").trim());
}

function isSupabasePublishableKey(value) {
  return /^sb_publishable_[^\s]+$/i.test(String(value || "").trim());
}

function validateAuthProviderConfig(authProvider) {
  const source = authProvider && typeof authProvider === "object" ? authProvider : {};
  const missing = [];

  if (!String(source.supabaseUrl || "").trim()) {
    missing.push("AUTH_SUPABASE_URL");
  }
  if (!String(source.supabasePublishableKey || "").trim()) {
    missing.push("AUTH_SUPABASE_PUBLISHABLE_KEY");
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required Supabase auth configuration: ${missing.join(", ")}. Re-run installation with explicit options or set these environment variables.`
    );
  }

  if (!isSupabaseUrl(source.supabaseUrl)) {
    throw new Error(
      `Invalid AUTH_SUPABASE_URL value "${String(source.supabaseUrl || "")}". Expected format: https://YOUR-PROJECT.supabase.co`
    );
  }
  if (!isSupabasePublishableKey(source.supabasePublishableKey)) {
    throw new Error(
      `Invalid AUTH_SUPABASE_PUBLISHABLE_KEY value "${String(source.supabasePublishableKey || "")}". Expected format: sb_publishable_...`
    );
  }
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
  if (scope.has(TOKENS.Env)) {
    dependencies.env = scope.make(TOKENS.Env);
  }
  if (scope.has(TOKENS.Logger)) {
    dependencies.logger = scope.make(TOKENS.Logger);
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

function createActionExecutor(actionRegistry) {
  return {
    execute(payload) {
      const source = normalizePlainObject(payload);
      return actionRegistry.execute({
        actionId: source.actionId,
        version: source.version == null ? null : source.version,
        input: normalizePlainObject(source.input),
        context: buildExecutionContext(source.context),
        deps: normalizePlainObject(source.deps)
      });
    },
    executeStream(payload) {
      const source = normalizePlainObject(payload);
      return actionRegistry.executeStream({
        actionId: source.actionId,
        version: source.version == null ? null : source.version,
        input: normalizePlainObject(source.input),
        context: buildExecutionContext(source.context),
        deps: normalizePlainObject(source.deps)
      });
    },
    listDefinitions() {
      return actionRegistry.listDefinitions();
    },
    getDefinition(actionId, version = null) {
      return actionRegistry.getDefinition(actionId, version);
    }
  };
}

class AuthSupabaseServiceProvider {
  static id = "auth.provider.supabase";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("AuthSupabaseServiceProvider requires application singleton()/has().");
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
        validateAuthProviderConfig(authProvider);
        const repositories = resolveOptionalRepositories(scope);
        const userProfilesRepository = repositories.userProfilesRepository || fallbackProfilesRepository;
        const userSettingsRepository = repositories.userSettingsRepository || fallbackUserSettingsRepository;

        return createService({
          authProvider,
          appPublicUrl: String(env.APP_PUBLIC_URL || "").trim(),
          nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
          userProfilesRepository,
          userSettingsRepository
        });
      });
    }

    if (!app.has("actionRegistry")) {
      app.singleton("actionRegistry", (scope) => {
        const authService = scope.make("authService");
        if (!authService) {
          return null;
        }

        const contributors = [];
        try {
          contributors.push(
            createAuthActionContributor({
              authService
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
          logger: scope.has(TOKENS.Logger) ? scope.make(TOKENS.Logger) : console
        });
      });
    }

    if (!app.has("actionExecutor")) {
      app.singleton("actionExecutor", (scope) => {
        const actionRegistry = scope.make("actionRegistry");
        if (!actionRegistry) {
          return null;
        }
        return createActionExecutor(actionRegistry);
      });
    }
  }
}

export { AuthSupabaseServiceProvider };
