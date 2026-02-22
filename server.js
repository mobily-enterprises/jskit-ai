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
import { env } from "./server/lib/env.js";
import { resolveAppConfig, toPublicAppConfig } from "./server/lib/appConfig.js";
import { listManifestPermissions, loadRbacManifest, manifestIncludesPermission } from "./server/lib/rbacManifest.js";
import { initDatabase, closeDatabase } from "./db/knex.js";
import { isAppError } from "./server/lib/errors.js";
import { registerApiRoutes } from "./server/fastify/registerApiRoutes.js";
import authPlugin from "./server/fastify/auth.plugin.js";
import billingWebhookRawBodyPlugin from "./server/fastify/billingWebhookRawBody.plugin.js";
import { registerSocketIoRealtime } from "./server/realtime/registerSocketIoRealtime.js";
import { safePathnameFromRequest } from "./server/lib/primitives/requestUrl.js";
import { AVATAR_MAX_UPLOAD_BYTES } from "./shared/avatar/index.js";
import { createSurfacePaths, resolveSurfaceFromPathname, resolveSurfacePaths } from "./shared/routing/surfacePaths.js";
import { surfaceRequiresWorkspace } from "./shared/routing/surfaceRegistry.js";
import {
  createRateLimitPluginOptions,
  resolveRateLimitStartupError,
  resolveRateLimitStartupWarning
} from "./server/lib/rateLimit.js";
import { createMetricsRegistry } from "./server/lib/observability/metrics.js";
import { createServerRuntime } from "./server/runtime/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_CONFIG = resolveAppConfig(env, { rootDir: __dirname });
const APP_CONFIG_PUBLIC = toPublicAppConfig(APP_CONFIG);
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

const NODE_ENV = resolveRuntimeEnv(env.NODE_ENV);
const PORT = Number(env.PORT) || 3000;
const FRONTEND_DIST_DIR = String(env.FRONTEND_DIST_DIR || "dist").trim() || "dist";
const PUBLIC_DIR = path.resolve(__dirname, FRONTEND_DIST_DIR);
const INDEX_FILE_NAME = "index.html";
const SUPABASE_PUBLISHABLE_KEY = String(env.SUPABASE_PUBLISHABLE_KEY || "");
const SCRIPT_SRC_POLICY = NODE_ENV === "production" ? ["'self'"] : ["'self'", "'unsafe-inline'"];
const LOG_LEVEL = String(env.LOG_LEVEL || "")
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

const {
  controllers,
  runtimeServices: {
    authService,
    workspaceService,
    consoleService,
    consoleErrorsService,
    realtimeEventsService,
    avatarStorageService,
    observabilityService,
    billingWorkerRuntimeService
  }
} = createServerRuntime({
  env,
  nodeEnv: NODE_ENV,
  appConfig: APP_CONFIG,
  rbacManifest: RBAC_MANIFEST,
  rootDir: __dirname,
  supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
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

  const aiRequiredPermission = String(env.AI_REQUIRED_PERMISSION || "").trim();
  if (aiRequiredPermission && !manifestIncludesPermission(RBAC_MANIFEST, aiRequiredPermission, { includeOwner: false })) {
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
    const appPublicUrl = String(env.APP_PUBLIC_URL || "").trim();
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
      mode: env.RATE_LIMIT_MODE,
      nodeEnv: NODE_ENV
    });
    if (rateLimitStartupError) {
      throw new Error(rateLimitStartupError);
    }

    const dbUser = String(env.DB_USER || "")
      .trim()
      .toLowerCase();
    if (dbUser === "root") {
      throw new Error("DB_USER must not be root in production.");
    }

    if (!env.SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required in production.");
    }
  }
}

function hasPathExtension(pathnameValue) {
  return path.extname(pathnameValue) !== "";
}

function resolveLoggerLevel() {
  if (ALLOWED_LOG_LEVELS.has(LOG_LEVEL)) {
    return LOG_LEVEL;
  }

  return NODE_ENV === "production" ? "info" : "debug";
}

function createFastifyLoggerOptions() {
  return {
    level: resolveLoggerLevel(),
    redact: {
      paths: LOG_REDACT_PATHS,
      censor: "[REDACTED]"
    }
  };
}

function registerRequestLoggingHooks(app, { observabilityService: instrumentationService, enableRequestLogs = true } = {}) {
  app.addHook("onRequest", async (request) => {
    request[REQUEST_STARTED_AT_SYMBOL] = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = request[REQUEST_STARTED_AT_SYMBOL];
    const durationMs =
      typeof startedAt === "bigint" ? Number(process.hrtime.bigint() - startedAt) / 1_000_000 : Number.NaN;
    const pathnameValue = safePathnameFromRequest(request);
    const routeUrl = String(request?.routeOptions?.url || "").trim();
    const surface = resolveSurfaceFromPathname(pathnameValue);
    const userId = Number(request?.user?.id);
    const logPayload = {
      requestId: String(request?.id || ""),
      method: String(request?.method || ""),
      path: pathnameValue,
      routeUrl,
      surface,
      statusCode: Number(reply?.statusCode || 0),
      durationMs: Number.isFinite(durationMs) ? Number(durationMs.toFixed(3)) : null
    };

    if (Number.isInteger(userId) && userId > 0) {
      logPayload.userId = userId;
    }

    if (instrumentationService && typeof instrumentationService.observeHttpRequest === "function") {
      instrumentationService.observeHttpRequest({
        method: logPayload.method,
        route: routeUrl || pathnameValue,
        surface,
        statusCode: logPayload.statusCode,
        durationMs
      });
    }

    if (enableRequestLogs) {
      request.log.info(logPayload, "request.completed");
    }
  });
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

function resolveDatabaseErrorCode(error) {
  const errorCode = String(error?.code || "")
    .trim()
    .toUpperCase();
  if (errorCode && (errorCode.startsWith("ER_") || errorCode.startsWith("SQLITE_") || errorCode.startsWith("PG"))) {
    return errorCode;
  }

  const sqlState = String(error?.sqlState || error?.sqlstate || "")
    .trim()
    .toUpperCase();
  if (sqlState) {
    return `SQLSTATE_${sqlState}`;
  }

  const errno = Number(error?.errno);
  if (Number.isInteger(errno)) {
    return `ERRNO_${errno}`;
  }

  const message = String(error?.message || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();
  if (message.includes("mysql") || message.includes("sql") || message.includes("knex") || name.includes("mysql")) {
    return "DB_UNKNOWN";
  }

  return "";
}

function recordDbErrorBestEffort(observabilityService, error) {
  if (!observabilityService || typeof observabilityService.recordDbError !== "function") {
    return;
  }

  const code = resolveDatabaseErrorCode(error);
  if (!code) {
    return;
  }

  observabilityService.recordDbError({ code });
}

function registerErrorHandler(app, { observabilityService: instrumentationService } = {}) {
  function recordServerErrorBestEffort(request, error, statusCode) {
    if (!consoleErrorsService || statusCode < 500) {
      return;
    }

    const pathnameValue = safePathnameFromRequest(request);
    if (pathnameValue.startsWith("/api/console/errors/")) {
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

  app.setErrorHandler((error, _request, reply) => {
    const request = _request;
    const normalizedErrorCode = String(error?.code || "").trim();
    const isCsrfErrorCode = normalizedErrorCode.startsWith("FST_CSRF_");
    const statusFromError = Number(error?.statusCode || error?.status);
    const statusCode =
      Number.isInteger(statusFromError) && statusFromError >= 400 && statusFromError <= 599 ? statusFromError : 500;

    if (error?.validation && Array.isArray(error.validation)) {
      const fieldErrors = {};
      for (const issue of error.validation) {
        const fieldFromPath = String(issue.instancePath || "")
          .replace(/^\//, "")
          .replace(/\//g, ".");
        const field =
          fieldFromPath ||
          String(issue.params?.missingProperty || issue.params?.additionalProperty || "request").trim();

        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message || "Invalid value.";
        }
      }

      reply.code(400).send({
        error: "Validation failed.",
        fieldErrors,
        details: {
          fieldErrors
        }
      });
      return;
    }

    if (isAppError(error)) {
      if (error.status >= 500) {
        recordDbErrorBestEffort(instrumentationService, error);
        recordServerErrorBestEffort(request, error, error.status);
        app.log.error({ err: error }, "AppError 5xx");
      }

      const payload = { error: error.message };
      if (error.details) {
        payload.details = error.details;
        if (error.details.fieldErrors) {
          payload.fieldErrors = error.details.fieldErrors;
        }
      }

      if (error.headers && typeof error.headers === "object") {
        Object.entries(error.headers).forEach(([name, value]) => {
          reply.header(name, value);
        });
      }

      reply.code(error.status).send(payload);
      return;
    }

    if (error.headers && typeof error.headers === "object") {
      Object.entries(error.headers).forEach(([name, value]) => {
        reply.header(name, value);
      });
    }

    if (statusCode >= 500) {
      recordDbErrorBestEffort(instrumentationService, error);
    }
    recordServerErrorBestEffort(request, error, statusCode);
    app.log.error({ err: error }, "Unhandled error");

    const message = statusCode >= 500 ? "Internal server error." : String(error?.message || "Request failed.");
    const payload = { error: message };
    if (isCsrfErrorCode) {
      payload.details = {
        code: normalizedErrorCode
      };
    }
    reply.code(statusCode).send(payload);
  });
}

function registerPageGuardHook(app) {
  app.addHook("preHandler", async (request, reply) => {
    const pathnameValue = safePathnameFromRequest(request);
    if (pathnameValue.startsWith("/api/")) {
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
    mode: env.RATE_LIMIT_MODE,
    redisUrl: env.REDIS_URL
  });

  const loggerOptions = NODE_ENV === "test" ? false : createFastifyLoggerOptions();
  const app = Fastify({
    logger: loggerOptions,
    disableRequestLogging: NODE_ENV !== "test",
    trustProxy: Boolean(env.TRUST_PROXY)
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
    observabilityService,
    enableRequestLogs: NODE_ENV !== "test"
  });

  const rateLimitStartupWarning = resolveRateLimitStartupWarning({
    mode: env.RATE_LIMIT_MODE,
    nodeEnv: NODE_ENV
  });
  if (rateLimitStartupWarning) {
    app.log.warn(rateLimitStartupWarning);
  }

  app.decorate("appConfig", APP_CONFIG_PUBLIC);
  app.decorate("rbacManifest", RBAC_MANIFEST);

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
          title: "Annuity Calculator API",
          version: "1.0.0",
          description: "API for auth, annuity calculations, and calculation history."
        },
        servers: [
          {
            url: "/"
          }
        ]
      }
    });

    await app.register(fastifySwaggerUi, {
      routePrefix: "/api/docs",
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
    redisUrl: env.REDIS_URL,
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
      aiEnabled: env.AI_ENABLED,
      aiRequiredPermission: env.AI_REQUIRED_PERMISSION,
      aiMaxInputChars: env.AI_MAX_INPUT_CHARS,
      aiMaxHistoryMessages: env.AI_MAX_HISTORY_MESSAGES
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

    if (pathnameValue.startsWith("/api/")) {
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
    console.log(`Annuity app listening on http://localhost:${port}`);
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
  let forcedExitTimer = null;

  if (signal) {
    console.log(`Received ${signal}. Shutting down.`);
  }

  stopBackgroundRuntimesForShutdown();

  if (exitProcess) {
    forcedExitTimer = setTimeout(() => {
      try {
        appInstance?.server?.closeIdleConnections?.();
        appInstance?.server?.closeAllConnections?.();
      } catch {
        // Ignore best-effort force-close failures.
      }

      console.error(
        `Graceful shutdown timed out after ${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms. Forcing process exit.`
      );
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    forcedExitTimer.unref?.();
  }

  try {
    if (appInstance) {
      await appInstance.close();
      appInstance = null;
    }
    await closeDatabase();
  } catch (error) {
    console.error("Failed to close server cleanly:", error);
    if (exitProcess) {
      process.exit(1);
    }
    throw error;
  } finally {
    if (forcedExitTimer) {
      clearTimeout(forcedExitTimer);
    }
    isShuttingDown = false;
  }

  if (exitProcess) {
    process.exit(exitCode);
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
