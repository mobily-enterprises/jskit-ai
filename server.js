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
import { env } from "./lib/env.js";
import { resolveAppConfig, toPublicAppConfig } from "./lib/appConfig.js";
import { loadRbacManifest } from "./lib/rbacManifest.js";
import { initDatabase, closeDatabase } from "./db/knex.js";
import { isAppError } from "./lib/errors.js";
import { registerApiRoutes } from "./routes/apiRoutes.js";
import authPlugin from "./plugins/auth.js";
import { createAuthService } from "./services/authService.js";
import * as annuityService from "./services/annuityService.js";
import { createAnnuityHistoryService } from "./services/annuityHistoryService.js";
import { createAuthController } from "./controllers/authController.js";
import { createHistoryController } from "./controllers/historyController.js";
import { createAnnuityController } from "./controllers/annuityController.js";
import { createSettingsController } from "./controllers/settingsController.js";
import { createWorkspaceController } from "./controllers/workspaceController.js";
import * as userProfilesRepository from "./repositories/userProfilesRepository.js";
import * as calculationLogsRepository from "./repositories/calculationLogsRepository.js";
import * as userSettingsRepository from "./repositories/userSettingsRepository.js";
import * as workspacesRepository from "./repositories/workspacesRepository.js";
import * as workspaceMembershipsRepository from "./repositories/workspaceMembershipsRepository.js";
import * as workspaceSettingsRepository from "./repositories/workspaceSettingsRepository.js";
import * as workspaceInvitesRepository from "./repositories/workspaceInvitesRepository.js";
import { safePathnameFromRequest } from "./lib/requestUrl.js";
import { createUserSettingsService } from "./services/userSettingsService.js";
import { createAvatarStorageService } from "./services/avatarStorageService.js";
import { createUserAvatarService } from "./services/userAvatarService.js";
import { createWorkspaceService } from "./services/workspaceService.js";
import { createWorkspaceAdminService } from "./services/workspaceAdminService.js";
import { AVATAR_MAX_UPLOAD_BYTES } from "./shared/avatar/index.js";
import { resolveSurfacePaths } from "./shared/routing/surfacePaths.js";

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
const PUBLIC_DIR = path.join(__dirname, "dist");
const INDEX_FILE_NAME = "index.html";
const SUPABASE_PUBLISHABLE_KEY = String(env.SUPABASE_PUBLISHABLE_KEY || "");
const SCRIPT_SRC_POLICY = NODE_ENV === "production" ? ["'self'"] : ["'self'", "'unsafe-inline'"];

const authService = createAuthService({
  supabaseUrl: env.SUPABASE_URL,
  supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
  appPublicUrl: env.APP_PUBLIC_URL,
  jwtAudience: env.SUPABASE_JWT_AUDIENCE,
  userProfilesRepository,
  userSettingsRepository,
  nodeEnv: NODE_ENV
});

const annuityHistoryService = createAnnuityHistoryService({
  calculationLogsRepository
});

const avatarStorageService = createAvatarStorageService({
  driver: env.AVATAR_STORAGE_DRIVER,
  fsBasePath: env.AVATAR_STORAGE_FS_BASE_PATH,
  publicBasePath: env.AVATAR_PUBLIC_BASE_PATH,
  rootDir: __dirname
});

const userAvatarService = createUserAvatarService({
  userProfilesRepository,
  avatarStorageService
});

const userSettingsService = createUserSettingsService({
  userSettingsRepository,
  userProfilesRepository,
  authService,
  userAvatarService
});

const workspaceService = createWorkspaceService({
  appConfig: APP_CONFIG,
  rbacManifest: RBAC_MANIFEST,
  workspacesRepository,
  workspaceMembershipsRepository,
  workspaceSettingsRepository,
  workspaceInvitesRepository,
  userSettingsRepository,
  userAvatarService
});

const workspaceAdminService = createWorkspaceAdminService({
  appConfig: APP_CONFIG,
  rbacManifest: RBAC_MANIFEST,
  workspacesRepository,
  workspaceSettingsRepository,
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  userProfilesRepository,
  userSettingsRepository
});

const controllers = {
  auth: createAuthController({ authService }),
  history: createHistoryController({ annuityHistoryService }),
  annuity: createAnnuityController({ annuityService, annuityHistoryService }),
  settings: createSettingsController({ userSettingsService, authService }),
  workspace: createWorkspaceController({ authService, workspaceService, workspaceAdminService })
};

function validateRuntimeConfig() {
  const tenancyMode = String(APP_CONFIG.tenancyMode || "").trim();
  if (!tenancyMode) {
    throw new Error("TENANCY_MODE must be configured.");
  }

  if (!APP_CONFIG.rbacManifestPath) {
    throw new Error("RBAC_MANIFEST_PATH must resolve to a readable manifest path.");
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

async function guardPageRoute(request, reply) {
  const pathnameValue = safePathnameFromRequest(request);
  const surfacePaths = resolveSurfacePaths(pathnameValue);
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
    }

    return true;
  } catch (error) {
    const statusCode = Number(error?.status || error?.statusCode);
    if (!surfacePaths.isPublicAuthPath(pathnameValue)) {
      if (statusCode === 403 || statusCode === 409) {
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

function registerErrorHandler(app) {
  app.setErrorHandler((error, _request, reply) => {
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

    app.log.error({ err: error }, "Unhandled error");

    const message = statusCode >= 500 ? "Internal server error." : String(error?.message || "Request failed.");
    reply.code(statusCode).send({ error: message });
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
  const app = Fastify({
    logger: NODE_ENV !== "test"
  });

  app.decorate("appConfig", APP_CONFIG_PUBLIC);
  app.decorate("rbacManifest", RBAC_MANIFEST);

  registerErrorHandler(app);
  app.setValidatorCompiler(TypeBoxValidatorCompiler);

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

  await app.register(authPlugin, { authService, workspaceService, nodeEnv: NODE_ENV });
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: AVATAR_MAX_UPLOAD_BYTES,
      files: 1,
      fields: 8
    }
  });

  await avatarStorageService.init();
  await app.register(fastifyStatic, {
    root: avatarStorageService.fsBasePath,
    prefix: `${avatarStorageService.publicBasePath}/`,
    decorateReply: false
  });

  if (frontendBuildAvailable) {
    await app.register(fastifyStatic, {
      root: PUBLIC_DIR,
      prefix: "/",
      index: false
    });
  }

  registerApiRoutes(app, { controllers });
  if (frontendBuildAvailable) {
    registerPageGuardHook(app);
  }

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
        error: "Frontend build is not available. Run `npm run dev` for development or `npm run build` for production."
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
    throw new Error("Frontend build not found. Run `npm run build` before starting the server.");
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

  if (signal) {
    console.log(`Received ${signal}. Shutting down.`);
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
