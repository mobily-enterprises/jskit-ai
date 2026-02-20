import { AppError } from "../../../lib/errors.js";
import { hasPermission } from "../../../lib/rbacManifest.js";
import { createWorkspaceRenameTool } from "./workspaceRename.tool.js";

function buildAiToolRegistry(deps = {}) {
  const workspaceRenameTool = createWorkspaceRenameTool(deps);

  return {
    [workspaceRenameTool.name]: workspaceRenameTool
  };
}

function listToolSchemas(registry) {
  const descriptors = registry && typeof registry === "object" ? Object.values(registry) : [];

  return descriptors.map((descriptor) => ({
    type: "function",
    function: {
      name: descriptor.name,
      description: descriptor.description,
      parameters: descriptor.inputJsonSchema
    }
  }));
}

async function executeToolCall(registry, { name, args, context }) {
  const normalizedName = String(name || "").trim();
  const descriptor = normalizedName ? registry?.[normalizedName] : null;

  if (!descriptor) {
    throw new AppError(400, "Unknown AI tool.", {
      code: "AI_TOOL_UNKNOWN"
    });
  }

  const requiredPermissions = Array.isArray(descriptor.requiredPermissions) ? descriptor.requiredPermissions : [];
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];

  for (const permission of requiredPermissions) {
    if (!hasPermission(permissions, permission)) {
      throw new AppError(403, "Forbidden.", {
        code: "AI_TOOL_FORBIDDEN"
      });
    }
  }

  return descriptor.execute({
    args: args && typeof args === "object" ? args : {},
    context
  });
}

export { buildAiToolRegistry, listToolSchemas, executeToolCall };
