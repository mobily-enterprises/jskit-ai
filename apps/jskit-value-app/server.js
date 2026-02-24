import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import { registerTypeBoxFormats } from "@jskit-ai/http-contracts/typeboxFormats";
import { resolveRepositoryConfigForRuntime } from "./config/index.js";
import { createPlatformRuntimeEnv } from "@jskit-ai/runtime-env-core/platformRuntimeEnv";
import { resolveAppConfig, toBrowserConfig } from "@jskit-ai/runtime-env-core/appRuntimePolicy";
import { listManifestPermissions, loadRbacManifest, manifestIncludesPermission } from "@jskit-ai/rbac-core";
import { initDatabase, closeDatabase } from "./db/knex.js";
import { isAppError } from "@jskit-ai/server-runtime-core/errors";
import {
  createFastifyLoggerOptions,
  registerApiErrorHandler,
  registerRequestLoggingHooks,
  recordDbErrorBestEffort,
  runGracefulShutdown
} from "@jskit-ai/server-runtime-core/fastifyBootstrap";
import { registerApiRoutes } from "./server/fastify/registerApiRoutes.js";
import authPlugin from "./server/fastify/auth.plugin.js";
import billingWebhookRawBodyPlugin from "./server/fastify/billingWebhookRawBody.plugin.js";
import { registerSocketIoRealtime } from "./server/realtime/registerSocketIoRealtime.js";
import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";
import { AVATAR_MAX_UPLOAD_BYTES } from "./shared/avatar.js";
import { createSurfacePaths, resolveSurfaceFromPathname, resolveSurfacePaths } from "./shared/surfacePaths.js";
import { surfaceRequiresWorkspace } from "./shared/surfaceRegistry.js";
import {
  createRateLimitPluginOptions,
  resolveRateLimitStartupError,
  resolveRateLimitStartupWarning
} from "@jskit-ai/redis-ops-core/rateLimit";
import { createMetricsRegistry } from "@jskit-ai/observability-core";
import { createServerRuntime } from "./server/runtime/index.js";
import {
  API_DOCS_PATH,
  API_MAJOR_VERSION,
  API_REALTIME_PATH,
  API_VERSION_SEGMENT,
  buildVersionedApiPath,
  isApiPath
} from "./shared/apiPaths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STORAGE_BASE_PATH = ".artifacts/storage";
const DEFAULT_RBAC_MANIFEST_PATH = "./shared/rbac.manifest.json";
const runtimeEnv = createPlatformRuntimeEnv({
  rootDir: __dirname,
  defaults: {
    RBAC_MANIFEST_PATH: DEFAULT_RBAC_MANIFEST_PATH,
    AVATAR_STORAGE_FS_BASE_PATH: DEFAULT_STORAGE_BASE_PATH,
    CHAT_ATTACHMENT_STORAGE_FS_BASE_PATH: DEFAULT_STORAGE_BASE_PATH
  }
});
const REPOSITORY_CONFIG = resolveRepositoryConfigForRuntime({
  nodeEnv: runtimeEnv.NODE_ENV
});
const APP_CONFIG = resolveAppConfig({ repositoryConfig: REPOSITORY_CONFIG, runtimeEnv, rootDir: __dirname });
const APP_CONFIG_BROWSER = toBrowserConfig(APP_CONFIG);
const RBAC_MANIFEST = await loadRbacManifest(APP_CONFIG.rbacManifestPath);

function resolveRuntimeEnv(nodeEnv) {
  if (nodeEnv === "production") {
    return "production";
  }
  if (nodeEnv === "test") {
    return "test";
  }
  return "development";
}

const NODE_ENV = resolveRuntimeEnv(runtimeEnv.NODE_ENV);
const PORT = Number(runtimeEnv.PORT) || 3000;
const FRONTEND_DIST_DIR = String(runtimeEnv.FRONTEND_DIST_DIR || "dist").trim() || "dist";
const PUBLIC_DIR = path.resolve(__dirname, FRONTEND_DIST_DIR);
const INDEX_FILE_NAME = "index.html";
const AUTH_PROVIDER_ID =
  String(runtimeEnv.AUTH_PROVIDER || "")
    .trim()
    .toLowerCase() || "supabase";
const AUTH_SUPABASE_URL = String(runtimeEnv.AUTH_SUPABASE_URL || "").trim();
const AUTH_SUPABASE_PUBLISHABLE_KEY = String(runtimeEnv.AUTH_SUPABASE_PUBLISHABLE_KEY || "").trim();
const SCRIPT_SRC_POLICY = NODE_ENV === "production" ? ["'self'"] : ["'self'", "'unsafe-inline'"];
const LOG_LEVEL = String(runtimeEnv.LOG_LEVEL || "")
  .trim()
  .toLowerCase();
const REQUEST_STARTED_AT_SYMBOL = Symbol("request_started_at_ns");
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;
const ALLOWED_LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace"]);
const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.x-api-key",
  "req.headers.x-auth-token",
  'req.headers["set-cookie"]',
  "res.headers.set-cookie",
  'res.headers["set-cookie"]',
  "*.password",
  "*.token",
  "*.access_token",
  "*.refresh_token"
];
const OBSERVABILITY_REGISTRY = createMetricsRegistry();
const API_CONSOLE_ERRORS_PREFIX = buildVersionedApiPath("/console/errors");

function isPathPrefixMatch(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

const {
  controllers,
  runtimeServices: {
    authService,
    workspaceService,
    consoleService,
    consoleErrorsService,
    realtimeEventsService,
    avatarStorageService,
    chatAttachmentStorageService,
    observabilityService,
    billingWorkerRuntimeService
  }
} = createServerRuntime({
  runtimeEnv,
  repositoryConfig: REPOSITORY_CONFIG,
  nodeEnv: NODE_ENV,
  appConfig: APP_CONFIG,
  rbacManifest: RBAC_MANIFEST,
  rootDir: __dirname,
  supabasePublishableKey: AUTH_SUPABASE_PUBLISHABLE_KEY,
  observabilityRegistry: OBSERVABILITY_REGISTRY
});

function validateRuntimeConfig() {
  const tenancyMode = String(APP_CONFIG.tenancyMode || "").trim();
  if (!tenancyMode) {
    throw new Error("TENANCY_MODE must be configured.");
  }

  if (!APP_CONFIG.rbacManifestPath) {
    throw new Error("RBAC_MANIFEST_PATH must resolve to a readable manifest path.");
  }

  const aiRequiredPermission = String(APP_CONFIG.features?.assistantRequiredPermission || "").trim();
  if (
    aiRequiredPermission &&
    !manifestIncludesPermission(RBAC_MANIFEST, aiRequiredPermission, { includeOwner: false })
  ) {
    const availablePermissions = listManifestPermissions(RBAC_MANIFEST, {
      includeOwner: false
    });
    const knownPermissionsHint =
      availablePermissions.length > 0
        ? ` Known non-owner permissions: ${availablePermissions.join(", ")}`
        : " No non-owner permissions are currently declared.";
    throw new Error(
      `AI_REQUIRED_PERMISSION="${aiRequiredPermission}" is not declared in RBAC manifest for non-owner roles.${knownPermissionsHint}`
    );
  }

  if (NODE_ENV !== "test") {
    const appPublicUrl = String(runtimeEnv.APP_PUBLIC_URL || "").trim();
    if (!appPublicUrl) {
      throw new Error("APP_PUBLIC_URL is required.");
    }

    let parsedAppPublicUrl;
    try {
      parsedAppPublicUrl = new URL(appPublicUrl);
    } catch {
      throw new Error("APP_PUBLIC_URL must be a valid absolute URL.");
    }

    if (parsedAppPublicUrl.protocol !== "http:" && parsedAppPublicUrl.protocol !== "https:") {
      throw new Error("APP_PUBLIC_URL must start with http:// or https://.");
    }
  }

  if (NODE_ENV === "production") {
    const rateLimitStartupError = resolveRateLimitStartupError({
      mode: runtimeEnv.RATE_LIMIT_MODE,
      nodeEnv: NODE_ENV
    });
    if (rateLimitStartupError) {
      throw new Error(rateLimitStartupError);
    }

    const dbUser = String(runtimeEnv.DB_USER || "")
      .trim()
      .toLowerCase();
    if (dbUser === "root") {
      throw new Error("DB_USER must not be root in production.");
    }

    if (AUTH_PROVIDER_ID === "supabase") {
      if (!AUTH_SUPABASE_URL || !AUTH_SUPABASE_PUBLISHABLE_KEY) {
        throw new Error(
          "AUTH_SUPABASE_URL and AUTH_SUPABASE_PUBLISHABLE_KEY are required in production when AUTH_PROVIDER=supabase."
        );
      }
    } else {
      throw new Error(`Unsupported AUTH_PROVIDER "${AUTH_PROVIDER_ID}".`);
    }
  }
}

function hasPathExtension(pathnameValue) {
  return path.extname(pathnameValue) !== "";
}

async function guardPageRoute(request, reply) {
  const pathnameValue = safePathnameFromRequest(request);
  const surfacePaths = resolveSurfacePaths(pathnameValue);
  const appSurfacePaths = createSurfacePaths("app");
  const requiresWorkspace = surfaceRequiresWorkspace(surfacePaths.surface);
  if (hasPathExtension(pathnameValue)) {
    return true;
  }

  const hasCookieHint =
    typeof authService.hasSessionCookie === "function"
      ? authService.hasSessionCookie(request)
      : authService.hasAccessTokenCookie(request);
  if (!hasCookieHint) {
    if (!surfacePaths.isPublicAuthPath(pathnameValue)) {
      reply.redirect(surfacePaths.loginPath);
      return false;
    }

    return true;
  }

  try {
    const authResult = await authService.authenticateRequest(request);
    if (authResult.clearSession) {
      authService.clearSessionCookies(reply);
    }
    if (authResult.session) {
      authService.writeSessionCookies(reply, authResult.session);
    }

    if (authResult.transientFailure) {
      return true;
    }

    if (!surfacePaths.isPublicAuthPath(pathnameValue) && !authResult.authenticated) {
      reply.redirect(surfacePaths.loginPath);
      return false;
    }

    if (surfacePaths.isLoginPath(pathnameValue) && authResult.authenticated) {
      if (!requiresWorkspace) {
        if (surfacePaths.surface === "console") {
          const consoleBootstrapPayload = await consoleService.buildBootstrapPayload({
            user: authResult.profile
          });
          const hasConsoleAccess = Boolean(consoleBootstrapPayload?.isConsole);
          const hasPendingConsoleInvites = Array.isArray(consoleBootstrapPayload?.pendingInvites)
            ? consoleBootstrapPayload.pendingInvites.length > 0
            : false;

          if (hasConsoleAccess) {
            reply.redirect(surfacePaths.rootPath);
          } else if (hasPendingConsoleInvites) {
            reply.redirect(surfacePaths.invitationsPath);
          } else {
            reply.redirect(appSurfacePaths.rootPath);
          }
        } else {
          reply.redirect(surfacePaths.rootPath);
        }
        return false;
      }

      const resolvedContext = await workspaceService.resolveRequestContext({
        user: authResult.profile,
        request,
        workspacePolicy: "optional"
      });

      if (resolvedContext.workspace) {
        reply.redirect(surfacePaths.workspaceHomePath(resolvedContext.workspace.slug));
      } else {
        reply.redirect(surfacePaths.workspacesPath);
      }
      return false;
    }

    if (authResult.authenticated) {
      if (requiresWorkspace) {
        const workspaceSlug = surfacePaths.extractWorkspaceSlug(pathnameValue);
        const requestWithWorkspaceHint = {
          ...request,
          params: {
            ...(request.params || {}),
            ...(workspaceSlug ? { workspaceSlug } : {})
          }
        };
        const workspacePolicy = workspaceSlug ? "required" : "optional";
        const resolvedContext = await workspaceService.resolveRequestContext({
          user: authResult.profile,
          request: requestWithWorkspaceHint,
          workspacePolicy
        });

        if (
          !resolvedContext.workspace &&
          !surfacePaths.isWorkspacesPath(pathnameValue) &&
          !surfacePaths.isAccountSettingsPath(pathnameValue) &&
          !surfacePaths.isPublicAuthPath(pathnameValue)
        ) {
          reply.redirect(surfacePaths.workspacesPath);
          return false;
        }

        if (
          resolvedContext.workspace &&
          surfacePaths.isWorkspacesPath(pathnameValue) &&
          APP_CONFIG.tenancyMode === "personal"
        ) {
          reply.redirect(surfacePaths.workspaceHomePath(resolvedContext.workspace.slug));
          return false;
        }
      } else if (surfacePaths.surface === "console") {
        const consoleBootstrapPayload = await consoleService.buildBootstrapPayload({
          user: authResult.profile
        });
        const hasConsoleAccess = Boolean(consoleBootstrapPayload?.isConsole);
        const hasPendingConsoleInvites = Array.isArray(consoleBootstrapPayload?.pendingInvites)
          ? consoleBootstrapPayload.pendingInvites.length > 0
          : false;

        if (surfacePaths.isInvitationsPath(pathnameValue)) {
          if (hasConsoleAccess) {
            reply.redirect(surfacePaths.rootPath);
            return false;
          }

          if (!hasPendingConsoleInvites) {
            reply.redirect(appSurfacePaths.rootPath);
            return false;
          }

          return true;
        }

        if (
          !surfacePaths.isPublicAuthPath(pathnameValue) &&
          !surfacePaths.isAccountSettingsPath(pathnameValue) &&
          !hasConsoleAccess
        ) {
          if (hasPendingConsoleInvites) {
            reply.redirect(surfacePaths.invitationsPath);
          } else {
            reply.redirect(appSurfacePaths.rootPath);
          }
          return false;
        }
      }
    }

    return true;
  } catch (error) {
    const statusCode = Number(error?.status || error?.statusCode);
    if (!surfacePaths.isPublicAuthPath(pathnameValue)) {
      if (surfacePaths.surface === "console") {
        reply.redirect(appSurfacePaths.rootPath);
        return false;
      }
      if (requiresWorkspace && (statusCode === 403 || statusCode === 409)) {
        reply.redirect(surfacePaths.workspacesPath);
        return false;
      }
      reply.redirect(surfacePaths.loginPath);
      return false;
    }

    return true;
  }
}

async function hasFrontendBuild() {
  const indexPath = path.join(PUBLIC_DIR, INDEX_FILE_NAME);
  try {
    await fs.access(indexPath);
    return true;
  } catch {
    return false;
  }
}

function registerErrorHandler(app, { observabilityService: instrumentationService } = {}) {
  function recordServerErrorBestEffort(request, error, statusCode) {
    if (!consoleErrorsService || statusCode < 500) {
      return;
    }

    const pathnameValue = safePathnameFromRequest(request);
    if (isPathPrefixMatch(pathnameValue, API_CONSOLE_ERRORS_PREFIX)) {
      return;
    }

    const hintedSurface = String(request?.headers?.["x-surface-id"] || "")
      .trim()
      .toLowerCase();
    const requestSurface = hintedSurface || resolveSurfaceFromPathname(pathnameValue);
    const routeUrl = String(request?.routeOptions?.url || "").trim();
    const userDisplayName = String(request?.user?.displayName || request?.user?.email || "").trim();
    const errorCode = String(error?.code || "").trim();

    void consoleErrorsService
      .recordServerError({
        requestId: String(request?.id || ""),
        method: String(request?.method || ""),
        path: pathnameValue,
        statusCode,
        errorName: String(error?.name || ""),
        message: String(error?.message || ""),
        stack: String(error?.stack || ""),
        userId: request?.user?.id == null ? null : Number(request.user.id),
        username: userDisplayName,
        metadata: {
          surface: requestSurface,
          routeUrl,
          code: errorCode,
          validationIssues: Array.isArray(error?.validation) ? error.validation.length : 0
        }
      })
      .catch((captureError) => {
        app.log.warn({ err: captureError }, "Failed to record server error log");
      });
  }

  registerApiErrorHandler(app, {
    isAppError,
    onRecordDbError(error) {
      recordDbErrorBestEffort(instrumentationService, error);
    },
    onCaptureServerError: recordServerErrorBestEffort
  });
}

function registerPageGuardHook(app) {
  app.addHook("preHandler", async (request, reply) => {
    const pathnameValue = safePathnameFromRequest(request);
    if (isApiPath(pathnameValue)) {
      return;
    }

    if (request.method !== "GET") {
      reply.code(405).send({ error: "Method not allowed." });
      return reply;
    }

    const allowed = await guardPageRoute(request, reply);
    if (!allowed) {
      return reply;
    }
  });
}

export async function buildServer({ frontendBuildAvailable }) {
  const rateLimitPluginOptions = createRateLimitPluginOptions({
    mode: runtimeEnv.RATE_LIMIT_MODE,
    redisUrl: runtimeEnv.REDIS_URL,
    redisNamespace: runtimeEnv.REDIS_NAMESPACE
  });

  const loggerOptions =
    NODE_ENV === "test"
      ? false
      : createFastifyLoggerOptions({
          configuredLevel: LOG_LEVEL,
          nodeEnv: NODE_ENV,
          allowedLevels: ALLOWED_LOG_LEVELS,
          redactPaths: LOG_REDACT_PATHS,
          redactCensor: "[REDACTED]"
        });
  const app = Fastify({
    logger: loggerOptions,
    disableRequestLogging: NODE_ENV !== "test",
    trustProxy: Boolean(runtimeEnv.TRUST_PROXY)
  });

  if (rateLimitPluginOptions?.redis) {
    app.addHook("onClose", async () => {
      const redisClient = rateLimitPluginOptions.redis;
      if (typeof redisClient.quit === "function") {
        try {
          await redisClient.quit();
          return;
        } catch {
          // Fall through to disconnect below.
        }
      }

      if (typeof redisClient.disconnect === "function") {
        redisClient.disconnect();
      }
    });
  }

  registerRequestLoggingHooks(app, {
    requestStartedAtSymbol: REQUEST_STARTED_AT_SYMBOL,
    getPathname: safePathnameFromRequest,
    getSurface: resolveSurfaceFromPathname,
    observeRequest:
      observabilityService && typeof observabilityService.observeHttpRequest === "function"
        ? observabilityService.observeHttpRequest.bind(observabilityService)
        : null,
    enableRequestLogs: NODE_ENV !== "test"
  });

  const rateLimitStartupWarning = resolveRateLimitStartupWarning({
    mode: runtimeEnv.RATE_LIMIT_MODE,
    nodeEnv: NODE_ENV
  });
  if (rateLimitStartupWarning) {
    app.log.warn(rateLimitStartupWarning);
  }

  app.decorate("browserConfig", APP_CONFIG_BROWSER);
  app.decorate("rbacManifest", RBAC_MANIFEST);

  registerTypeBoxFormats();
  registerErrorHandler(app, { observabilityService });
  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  await app.register(billingWebhookRawBodyPlugin);

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: SCRIPT_SRC_POLICY,
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://www.gravatar.com", "https://secure.gravatar.com"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  });

  if (NODE_ENV !== "production") {
    await app.register(fastifySwagger, {
      openapi: {
        openapi: "3.0.3",
        info: {
          title: "Jskit API",
          version: `${API_MAJOR_VERSION}.0.0 (${API_VERSION_SEGMENT})`,
          description: "API for auth, DEG2RAD calculations, and calculation history."
        },
        servers: [
          {
            url: "/"
          }
        ]
      }
    });

    await app.register(fastifySwaggerUi, {
      routePrefix: API_DOCS_PATH,
      uiConfig: {
        docExpansion: "list",
        deepLinking: false
      },
      staticCSP: true,
      transformSpecificationClone: true
    });
  }

  await app.register(authPlugin, {
    authService,
    workspaceService,
    observabilityService,
    nodeEnv: NODE_ENV,
    rateLimitPluginOptions
  });
  await registerSocketIoRealtime(app, {
    authService,
    realtimeEventsService,
    workspaceService,
    path: API_REALTIME_PATH,
    redisUrl: runtimeEnv.REDIS_URL,
    requireRedisAdapter: NODE_ENV === "production",
    logger: app.log
  });
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: AVATAR_MAX_UPLOAD_BYTES,
      files: 1,
      fields: 8
    }
  });

  await avatarStorageService.init();
  await chatAttachmentStorageService.init();
  await avatarStorageService.registerDelivery(app, { fastifyStatic });

  if (frontendBuildAvailable) {
    await app.register(fastifyStatic, {
      root: PUBLIC_DIR,
      prefix: "/",
      index: false
    });
  }

  registerApiRoutes(app, {
    controllers,
    routeConfig: {
      aiEnabled: REPOSITORY_CONFIG.ai.enabled,
      aiRequiredPermission: REPOSITORY_CONFIG.ai.requiredPermission,
      aiMaxInputChars: REPOSITORY_CONFIG.ai.maxInputChars,
      aiMaxHistoryMessages: REPOSITORY_CONFIG.ai.maxHistoryMessages,
      chatMessageMaxTextChars: REPOSITORY_CONFIG.chat.messageMaxTextChars,
      chatMessagesPageSizeMax: REPOSITORY_CONFIG.chat.messagesPageSizeMax,
      chatThreadsPageSizeMax: REPOSITORY_CONFIG.chat.threadsPageSizeMax,
      chatAttachmentsMaxFilesPerMessage: REPOSITORY_CONFIG.chat.attachmentsMaxFilesPerMessage,
      chatAttachmentMaxUploadBytes: REPOSITORY_CONFIG.chat.attachmentMaxUploadBytes
    }
  });
  if (frontendBuildAvailable) {
    registerPageGuardHook(app);
  }

  app.addHook("onReady", async () => {
    if (billingWorkerRuntimeService && typeof billingWorkerRuntimeService.start === "function") {
      billingWorkerRuntimeService.start();
    }
  });

  app.addHook("onClose", async () => {
    if (billingWorkerRuntimeService && typeof billingWorkerRuntimeService.stop === "function") {
      billingWorkerRuntimeService.stop();
    }
  });

  app.setNotFoundHandler(async (request, reply) => {
    const pathnameValue = safePathnameFromRequest(request);

    if (isApiPath(pathnameValue)) {
      reply.code(404).send({ error: "Not found." });
      return;
    }

    if (request.method !== "GET") {
      reply.code(405).send({ error: "Method not allowed." });
      return;
    }

    if (!frontendBuildAvailable) {
      reply.code(404).send({
        error: `Frontend build is not available in "${FRONTEND_DIST_DIR}". Run \`npm run dev\` for development, or build the client and set FRONTEND_DIST_DIR to the output directory.`
      });
      return;
    }

    if (hasPathExtension(pathnameValue)) {
      reply.code(404).send({ error: "Not found." });
      return;
    }

    reply.type("text/html; charset=utf-8");
    await reply.sendFile(INDEX_FILE_NAME);
  });

  return app;
}

let appInstance = null;
let isShuttingDown = false;
let signalHandlersRegistered = false;

function stopBackgroundRuntimesForShutdown() {
  if (!billingWorkerRuntimeService || typeof billingWorkerRuntimeService.stop !== "function") {
    return;
  }

  try {
    billingWorkerRuntimeService.stop();
  } catch (error) {
    console.warn("Failed to stop billing worker runtime during shutdown:", error);
  }
}

export async function createServerApp({ frontendBuildAvailable } = {}) {
  const resolvedFrontendBuildAvailable =
    typeof frontendBuildAvailable === "boolean" ? frontendBuildAvailable : await hasFrontendBuild();

  return buildServer({ frontendBuildAvailable: resolvedFrontendBuildAvailable });
}

export async function startServer({ port = PORT, host = "0.0.0.0", frontendBuildAvailable } = {}) {
  validateRuntimeConfig();
  const resolvedFrontendBuildAvailable =
    typeof frontendBuildAvailable === "boolean" ? frontendBuildAvailable : await hasFrontendBuild();

  if (NODE_ENV === "production" && !resolvedFrontendBuildAvailable) {
    throw new Error(
      `Frontend build not found in "${FRONTEND_DIST_DIR}". Build the client and set FRONTEND_DIST_DIR to the output directory before starting the server.`
    );
  }

  await initDatabase();

  try {
    appInstance = await buildServer({ frontendBuildAvailable: resolvedFrontendBuildAvailable });
    await appInstance.listen({ port, host });
    console.log(`Jskit app listening on http://localhost:${port}`);
    return appInstance;
  } catch (error) {
    if (appInstance) {
      try {
        await appInstance.close();
      } catch {
        // Ignore close errors during startup failure.
      }
      appInstance = null;
    }

    await closeDatabase();
    throw error;
  }
}

export async function shutdownServer({ signal = "", exitProcess = false, exitCode = 0 } = {}) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  const appToClose = appInstance;
  appInstance = null;

  try {
    await runGracefulShutdown({
      signal,
      exitProcess,
      exitCode,
      timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
      appInstance: appToClose,
      stopBackgroundRuntimes: stopBackgroundRuntimesForShutdown,
      closeDatabase,
      logger: console
    });
  } finally {
    isShuttingDown = false;
  }
}

export function registerSignalHandlers() {
  if (signalHandlersRegistered) {
    return;
  }
  signalHandlersRegistered = true;

  process.on("SIGINT", () => {
    void shutdownServer({ signal: "SIGINT", exitProcess: true, exitCode: 0 });
  });

  process.on("SIGTERM", () => {
    void shutdownServer({ signal: "SIGTERM", exitProcess: true, exitCode: 0 });
  });
}
