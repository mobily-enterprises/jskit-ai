import fp from "fastify-plugin";
import { authPolicyPlugin } from "@jskit-ai/fastify-auth-policy/server/lib/plugin";

import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { hasPermission } from "@jskit-ai/rbac-core/server/lib/rbac";
import { API_PREFIX_SLASH } from "../../shared/apiPaths.js";
import { resolveRequestSurface } from "../shared/resolveRequestSurface.js";

function recordAuthFailure(observabilityService, request, reason, meta) {
  if (!observabilityService || typeof observabilityService.recordAuthFailure !== "function") {
    return;
  }

  observabilityService.recordAuthFailure({
    reason,
    surface: resolveRequestSurface({
      request,
      explicitSurface: meta?.workspaceSurface
    })
  });
}

async function authPlugin(fastify, options) {
  const authService = options.authService;
  const workspaceService = options.workspaceService || null;
  const consoleService = options.consoleService || null;
  const observabilityService = options.observabilityService || null;
  const rateLimitPluginOptions =
    options.rateLimitPluginOptions && typeof options.rateLimitPluginOptions === "object"
      ? options.rateLimitPluginOptions
      : {
          global: false
        };
  if (!authService) {
    throw new Error("authService is required.");
  }

  const registerPolicyPlugin = authPolicyPlugin(
    {
      async resolveActor(request, reply) {
        const authResult = await authService.authenticateRequest(request);
        if (authResult.clearSession) {
          authService.clearSessionCookies(reply);
        }
        if (authResult.session) {
          authService.writeSessionCookies(reply, authResult.session);
        }

        return {
          authenticated: authResult.authenticated,
          actor: authResult.profile || null,
          transientFailure: authResult.transientFailure
        };
      },
      async resolveContext({ request, actor, meta }) {
        const requestedSurface = resolveRequestSurface({
          request,
          explicitSurface: meta?.workspaceSurface
        });

        if (requestedSurface === "console" && consoleService) {
          const resolveConsoleContext =
            typeof consoleService.resolveRequestContext === "function"
              ? consoleService.resolveRequestContext.bind(consoleService)
              : null;
          if (resolveConsoleContext) {
            const context = await resolveConsoleContext({
              user: actor
            });
            return {
              workspace: null,
              membership: context?.membership || null,
              permissions: Array.isArray(context?.permissions) ? context.permissions : []
            };
          }
        }

        if (!workspaceService) {
          return null;
        }

        return workspaceService.resolveRequestContext({
          user: actor,
          request,
          workspacePolicy: meta.workspacePolicy,
          workspaceSurface: meta.workspaceSurface
        });
      },
      hasPermission({ permission, permissions }) {
        return hasPermission(permissions, permission);
      },
      onPolicyDenied({ reason, request, meta }) {
        recordAuthFailure(observabilityService, request, reason, meta);
      }
    },
    {
      nodeEnv: options.nodeEnv,
      apiPrefix: API_PREFIX_SLASH,
      rateLimitPluginOptions,
      createError(status, message) {
        return new AppError(status, message);
      }
    }
  );

  await registerPolicyPlugin(fastify);
}

export default fp(authPlugin);
