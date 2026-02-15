import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyHelmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import { env } from "./lib/env.js";
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
import * as userProfilesRepository from "./repositories/userProfilesRepository.js";
import * as calculationLogsRepository from "./repositories/calculationLogsRepository.js";
import { safePathnameFromRequest } from "./lib/requestUrl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NODE_ENV = env.NODE_ENV === "production" ? "production" : "development";
const PORT = Number(env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "dist");
const INDEX_FILE_NAME = "index.html";
const SUPABASE_PUBLISHABLE_KEY = String(env.SUPABASE_PUBLISHABLE_KEY || "");

const authService = createAuthService({
  supabaseUrl: env.SUPABASE_URL,
  supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
  appPublicUrl: env.APP_PUBLIC_URL,
  jwtAudience: env.SUPABASE_JWT_AUDIENCE,
  userProfilesRepository,
  nodeEnv: NODE_ENV
});

const annuityHistoryService = createAnnuityHistoryService({
  calculationLogsRepository
});

const controllers = {
  auth: createAuthController({ authService }),
  history: createHistoryController({ annuityHistoryService }),
  annuity: createAnnuityController({ annuityService, annuityHistoryService })
};

function validateRuntimeConfig() {
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

function isPublicAuthPage(pathnameValue) {
  return pathnameValue === "/login" || pathnameValue === "/reset-password";
}

async function guardPageRoute(request, reply) {
  const pathnameValue = safePathnameFromRequest(request);
  if (hasPathExtension(pathnameValue)) {
    return true;
  }

  const hasCookieHint = authService.hasAccessTokenCookie(request);
  if (!hasCookieHint) {
    if (!isPublicAuthPage(pathnameValue)) {
      reply.redirect("/login");
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

    if (pathnameValue === "/login" && authResult.authenticated) {
      reply.redirect("/");
      return false;
    }

    if (!isPublicAuthPage(pathnameValue) && !authResult.authenticated) {
      reply.redirect("/login");
      return false;
    }

    return true;
  } catch {
    if (!isPublicAuthPage(pathnameValue)) {
      reply.redirect("/login");
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

async function buildServer({ frontendBuildAvailable }) {
  const app = Fastify({
    logger: NODE_ENV !== "test"
  });

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
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
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

  await app.register(authPlugin, { authService, nodeEnv: NODE_ENV });

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

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(`Received ${signal}. Shutting down.`);

  try {
    if (appInstance) {
      await appInstance.close();
    }
    await closeDatabase();
  } catch (error) {
    console.error("Failed to close server cleanly:", error);
  } finally {
    process.exit(0);
  }
}

async function startServer() {
  try {
    validateRuntimeConfig();
    const frontendBuildAvailable = await hasFrontendBuild();
    if (NODE_ENV === "production" && !frontendBuildAvailable) {
      throw new Error("Frontend build not found. Run `npm run build` before starting the server.");
    }
    await initDatabase();

    appInstance = await buildServer({ frontendBuildAvailable });
    await appInstance.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`Annuity app listening on http://localhost:${PORT}`);
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

startServer();
