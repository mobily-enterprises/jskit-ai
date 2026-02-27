import { buildRoutes as buildAuthRoutes } from "@jskit-ai/auth-fastify-adapter";
import { buildRoutes as buildWorkspaceRoutes } from "@jskit-ai/workspace-service-core";
import { buildRoutes as buildConsoleRoutes } from "@jskit-ai/console-fastify-adapter";
import { buildRoutes as buildConsoleErrorsRoutes } from "@jskit-ai/console-errors-fastify-adapter";
import { buildRoutes as buildCommunicationsRoutes } from "../modules/communications/index.js";
import { buildRoutes as buildProjectsRoutes } from "../modules/projects/index.js";
import { buildRoutes as buildChatRoutes } from "../modules/chat/index.js";
import { buildRoutes as buildSocialRoutes } from "../modules/social/index.js";
import { buildRoutes as buildBillingRoutes } from "@jskit-ai/billing-fastify-adapter/routes";
import { buildRoutes as buildSettingsRoutes } from "../modules/settings/index.js";
import { buildRoutes as buildAlertsRoutes } from "../modules/alerts/index.js";
import { buildRoutes as buildHistoryRoutes } from "../modules/history/index.js";
import { buildRoutes as buildDeg2radRoutes } from "../modules/deg2rad/index.js";
import { buildRoutes as buildHealthRoutes } from "@jskit-ai/health-fastify-adapter";
import { buildRoutes as buildObservabilityRoutes } from "@jskit-ai/observability-core";
import { buildRoutes as buildAiRoutes } from "../modules/ai/index.js";
import { API_PREFIX, toVersionedApiPath } from "../../shared/apiPaths.js";

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
  const pathValue = toVersionedApiPath(route?.path);
  const consoleApiPath = `${API_PREFIX}/console`;
  const isConsoleApiPath = pathValue === consoleApiPath || pathValue.startsWith(`${consoleApiPath}/`);
  if (!isConsoleApiPath) {
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

export { ROUTE_MODULE_DEFINITIONS, withConsoleRoutePolicy, createMissingHandler };
