import fp from "fastify-plugin";
import { authPolicyPlugin } from "@jskit-ai/fastify-auth-policy";

import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { hasPermission } from "@jskit-ai/rbac-core";
import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";
import { API_PREFIX_SLASH } from "../../shared/apiPaths.js";
import { resolveSurfaceFromPathname } from "../../shared/surfacePaths.js";

function resolveRequestSurface(request) {
  const pathnameValue = safePathnameFromRequest(request);
  return resolveSurfaceFromPathname(pathnameValue);
}

function recordAuthFailure(observabilityService, request, reason) {
  if (!observabilityService || typeof observabilityService.recordAuthFailure !== "function") {
    return;
  }

  observabilityService.recordAuthFailure({
    reason,
    surface: resolveRequestSurface(request)
  });
}

async function authPlugin(fastify, options) {
  const authService = options.authService;
  const workspaceService = options.workspaceService || null;
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
      onPolicyDenied({ reason, request }) {
        recordAuthFailure(observabilityService, request, reason);
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
