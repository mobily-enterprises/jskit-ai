import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAssistantMcp, createAssistantMcpActions, registerAssistantMcpRoutes } from "./mcp.js";

/**
 * The application's MCP endpoint, when its configuration names one (`assistantMcp: { surfaceId }`): the actions of
 * that surface as the tools of a remote MCP server, for the person signed in to each request (mcp.js). Without
 * `assistantMcp` it registers nothing.
 */
const AssistantMcpFeature = defineFeature({
  id: "assistant.mcp",
  domain: "assistant",
  requires: {
    config: "runtime.config",
    http: "runtime.http"
  },
  optional: {
    workspaces: "workspaces.core"
  },
  provides: {
    mcp: "assistant.mcp"
  },
  setup(dependencies, { actionCatalogue }) {
    const endpoint = createAssistantMcp({
      actions: actionCatalogue,
      config: dependencies.config,
      workspaceScopeSupport: dependencies.workspaces?.scope || null
    });
    registerAssistantMcpRoutes(dependencies.http.router, { mcp: endpoint });
    return { mcp: Object.freeze({ endpoint }) };
  },
  actions({ mcp }) {
    return createAssistantMcpActions({ mcp: mcp.endpoint });
  }
});

export { AssistantMcpFeature };
