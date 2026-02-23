import {
  buildAiToolRegistry as buildAssistantCoreToolRegistry,
  executeToolCall as executeAssistantCoreToolCall,
  listToolSchemas
} from "../../../../../../packages/ai-agent/assistant-core/src/toolRegistry.js";
import { AppError } from "../../../lib/errors.js";
import { hasPermission } from "../../../lib/rbacManifest.js";
import { createWorkspaceRenameTool } from "./workspaceRename.tool.js";

function buildAiToolRegistry(deps = {}) {
  const workspaceRenameTool = createWorkspaceRenameTool(deps);
  const extraTools = Array.isArray(deps?.tools) ? deps.tools : [];
  return buildAssistantCoreToolRegistry({
    tools: [workspaceRenameTool, ...extraTools]
  });
}

async function executeToolCall(registry, { name, args, context }) {
  return executeAssistantCoreToolCall(registry, {
    name,
    args,
    context,
    appErrorClass: AppError,
    hasPermissionFn: hasPermission
  });
}

export { buildAiToolRegistry, listToolSchemas, executeToolCall };
