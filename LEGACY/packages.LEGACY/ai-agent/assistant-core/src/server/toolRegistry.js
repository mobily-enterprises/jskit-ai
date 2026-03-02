import { defaultHasPermission } from "./permissions.js";

class DefaultAppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = options.code || "APP_ERROR";
    this.details = options.details;
    this.headers = options.headers || {};
  }
}

function buildAiToolRegistry({ tools = [] } = {}) {
  const entries = Array.isArray(tools) ? tools : [];
  const registry = {};

  for (const descriptor of entries) {
    const name = String(descriptor?.name || "").trim();
    if (!name) {
      continue;
    }
    if (typeof descriptor.execute !== "function") {
      continue;
    }

    registry[name] = {
      ...descriptor,
      name
    };
  }

  return registry;
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

async function executeToolCall(
  registry,
  { name, args, context, appErrorClass = null, hasPermissionFn = null } = {}
) {
  const AppError = typeof appErrorClass === "function" ? appErrorClass : DefaultAppError;
  const permissionCheck = typeof hasPermissionFn === "function" ? hasPermissionFn : defaultHasPermission;
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
    if (!permissionCheck(permissions, permission)) {
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

const __testables = {
  DefaultAppError,
  defaultHasPermission
};

export { buildAiToolRegistry, listToolSchemas, executeToolCall, __testables };
