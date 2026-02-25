import { buildRoutes as buildAuthRoutes } from "@jskit-ai/auth-fastify-adapter";
import { buildRoutes as buildWorkspaceRoutes } from "@jskit-ai/workspace-fastify-adapter";
import { buildRoutes as buildConsoleRoutes } from "@jskit-ai/console-fastify-adapter";
import { buildRoutes as buildConsoleErrorsRoutes } from "@jskit-ai/console-errors-fastify-adapter";
import { buildRoutes as buildCommunicationsRoutes } from "../communications/index.js";
import { buildRoutes as buildProjectsRoutes } from "../projects/index.js";
import { buildRoutes as buildChatRoutes } from "../chat/index.js";
import { buildRoutes as buildSocialRoutes } from "../social/index.js";
import { buildRoutes as buildBillingRoutes } from "@jskit-ai/billing-fastify-adapter/routes";
import { buildRoutes as buildSettingsRoutes } from "../settings/index.js";
import { buildRoutes as buildAlertsRoutes } from "../alerts/index.js";
import { buildRoutes as buildHistoryRoutes } from "../history/index.js";
import { buildRoutes as buildDeg2radRoutes } from "../deg2rad/index.js";
import { buildRoutes as buildHealthRoutes } from "@jskit-ai/health-fastify-adapter";
import { buildRoutes as buildObservabilityRoutes } from "@jskit-ai/observability-fastify-adapter";
import { buildRoutes as buildAiRoutes } from "../ai/index.js";
import { buildRoutesFromManifest } from "@jskit-ai/server-runtime-core/runtimeAssembly";
import { toVersionedApiPath } from "../../../shared/apiPaths.js";

const ROUTE_MODULE_DEFINITIONS = Object.freeze([
  {
    id: "health",
    buildRoutes: buildHealthRoutes
  },
  {
    id: "observability",
    buildRoutes: buildObservabilityRoutes
  },
  {
    id: "auth",
    buildRoutes: buildAuthRoutes
  },
  {
    id: "workspace",
    buildRoutes: buildWorkspaceRoutes
  },
  {
    id: "console",
    buildRoutes: buildConsoleRoutes
  },
  {
    id: "consoleErrors",
    buildRoutes: buildConsoleErrorsRoutes
  },
  {
    id: "communications",
    buildRoutes: buildCommunicationsRoutes
  },
  {
    id: "projects",
    buildRoutes: buildProjectsRoutes
  },
  {
    id: "chat",
    buildRoutes: buildChatRoutes,
    resolveOptions: (routeConfig = {}) => ({
      messageMaxChars: routeConfig.chatMessageMaxTextChars,
      messagePageSizeMax: routeConfig.chatMessagesPageSizeMax,
      threadPageSizeMax: routeConfig.chatThreadsPageSizeMax,
      attachmentsMaxFilesPerMessage: routeConfig.chatAttachmentsMaxFilesPerMessage,
      attachmentMaxUploadBytes: routeConfig.chatAttachmentMaxUploadBytes
    })
  },
  {
    id: "social",
    buildRoutes: buildSocialRoutes,
    resolveOptions: (routeConfig = {}) => ({
      postMaxChars: routeConfig.socialPostMaxChars,
      commentMaxChars: routeConfig.socialCommentMaxChars,
      feedPageSizeMax: routeConfig.socialFeedPageSizeMax,
      notificationsPageSizeMax: routeConfig.socialNotificationsPageSizeMax,
      actorSearchLimitMax: routeConfig.socialActorSearchLimitMax,
      inboxMaxPayloadBytes: routeConfig.socialInboxMaxPayloadBytes
    })
  },
  {
    id: "billing",
    buildRoutes: buildBillingRoutes
  },
  {
    id: "ai",
    buildRoutes: buildAiRoutes,
    resolveOptions: (routeConfig = {}) => ({
      aiEnabled: routeConfig.aiEnabled,
      aiRequiredPermission: routeConfig.aiRequiredPermission,
      aiMaxInputChars: routeConfig.aiMaxInputChars,
      aiMaxHistoryMessages: routeConfig.aiMaxHistoryMessages
    })
  },
  {
    id: "settings",
    buildRoutes: buildSettingsRoutes
  },
  {
    id: "alerts",
    buildRoutes: buildAlertsRoutes
  },
  {
    id: "history",
    buildRoutes: buildHistoryRoutes
  },
  {
    id: "deg2rad",
    buildRoutes: buildDeg2radRoutes
  }
]);

function withConsoleRoutePolicy(route) {
  const pathValue = String(route?.path || "");
  if (!pathValue.startsWith("/api/console")) {
    return route;
  }

  return {
    ...route,
    workspacePolicy: route.workspacePolicy || "optional",
    workspaceSurface: route.workspaceSurface || "console"
  };
}

function createMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "Endpoint is not available in this server wiring."
    });
  };
}

function buildRoutes(controllers, routeConfig = {}) {
  const missingHandler = createMissingHandler();

  const routes = buildRoutesFromManifest({
    definitions: ROUTE_MODULE_DEFINITIONS,
    controllers,
    routeConfig,
    missingHandler
  }).map(withConsoleRoutePolicy);

  return routes.map((route) => ({
    ...route,
    path: toVersionedApiPath(route.path)
  }));
}

export { ROUTE_MODULE_DEFINITIONS, buildRoutes };
