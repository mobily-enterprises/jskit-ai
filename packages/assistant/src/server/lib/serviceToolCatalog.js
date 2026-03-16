import { requireAuth, resolveServiceRegistrations } from "@jskit-ai/kernel/server/runtime";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const DEFAULT_TOOL_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    args: {
      type: "array",
      items: {}
    },
    options: {
      type: "object",
      additionalProperties: true
    }
  },
  additionalProperties: true
});

function normalizeBarredEntry(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeBarredMethodSet(value) {
  const source = Array.isArray(value) ? value : [value];
  return new Set(source.map((entry) => normalizeBarredEntry(entry)).filter(Boolean));
}

function isMethodBarred(barredSet, serviceToken, methodName) {
  const token = normalizeText(serviceToken).toLowerCase();
  const method = normalizeText(methodName).toLowerCase();
  if (!token || !method) {
    return true;
  }

  return (
    barredSet.has(token) ||
    barredSet.has(`${token}.*`) ||
    barredSet.has(`${token}.${method}`)
  );
}

function sanitizeToolName(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return "tool";
  }

  return normalized;
}

function resolveUniqueToolName(baseName, used) {
  const normalizedBase = sanitizeToolName(baseName).slice(0, 56) || "tool";
  let candidate = normalizedBase;
  let suffix = 1;

  while (used.has(candidate)) {
    candidate = `${normalizedBase}_${suffix}`.slice(0, 64);
    suffix += 1;
  }

  used.add(candidate);
  return candidate;
}

function parseToolArguments(argumentsText) {
  const source = String(argumentsText || "").trim();
  if (!source) {
    return {
      args: [],
      options: {}
    };
  }

  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) {
      return {
        args: parsed,
        options: {}
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return {
        args: [parsed],
        options: {}
      };
    }

    const parsedArgs = Array.isArray(parsed.args) ? parsed.args : [];
    const parsedOptions = parsed.options && typeof parsed.options === "object" && !Array.isArray(parsed.options)
      ? parsed.options
      : {};

    if (Array.isArray(parsed.args) || Object.hasOwn(parsed, "options")) {
      return {
        args: parsedArgs,
        options: parsedOptions
      };
    }

    return {
      args: [parsed],
      options: {}
    };
  } catch {
    return {
      args: [],
      options: {}
    };
  }
}

function canInvokeMethod(permission, context) {
  const permissionSpec = permission && typeof permission === "object" ? permission : { require: "none" };

  try {
    requireAuth(
      {
        context
      },
      permissionSpec
    );
    return true;
  } catch {
    return false;
  }
}

function resolveMethodSchema(scope, serviceToken, methodName) {
  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function") {
    return null;
  }

  if (!scope.has(KERNEL_TOKENS.ServiceSchemaCatalog)) {
    return null;
  }

  const catalog = scope.make(KERNEL_TOKENS.ServiceSchemaCatalog);
  if (!catalog || typeof catalog.getServiceMethodSchema !== "function") {
    return null;
  }

  return catalog.getServiceMethodSchema(serviceToken, methodName);
}

function resolveServiceMethodEntries(
  scope,
  { barredServiceMethods = [], skipServicePrefixes = [], requireMethodSchemas = false } = {}
) {
  const registrations = resolveServiceRegistrations(scope);
  const barredSet = normalizeBarredMethodSet(barredServiceMethods);
  const usedToolNames = new Set();
  const entries = [];

  for (const registration of registrations) {
    const serviceToken = normalizeText(registration?.serviceToken);
    if (!serviceToken) {
      continue;
    }

    const normalizedToken = serviceToken.toLowerCase();
    const skipByPrefix = skipServicePrefixes.some((prefix) => normalizedToken.startsWith(prefix));
    if (skipByPrefix) {
      continue;
    }

    const service = scope.make(serviceToken);
    if (!service || typeof service !== "object") {
      continue;
    }

    const servicePermissions = service?.servicePermissions && typeof service.servicePermissions === "object"
      ? service.servicePermissions
      : {};

    for (const [methodName, method] of Object.entries(service)) {
      if (typeof method !== "function") {
        continue;
      }

      if (isMethodBarred(barredSet, serviceToken, methodName)) {
        continue;
      }

      const methodPermission = servicePermissions?.[methodName] || { require: "none" };
      const methodSchema = resolveMethodSchema(scope, serviceToken, methodName);
      if (requireMethodSchemas && (!methodSchema?.inputSchema || !methodSchema?.outputSchema)) {
        continue;
      }
      const toolName = resolveUniqueToolName(`${serviceToken}_${methodName}`, usedToolNames);
      entries.push(
        Object.freeze({
          descriptor: Object.freeze({
            name: toolName,
            serviceToken,
            methodName,
            description: normalizeText(methodSchema?.description) || `Call ${serviceToken}.${methodName}().`,
            parameters: methodSchema?.inputSchema || DEFAULT_TOOL_INPUT_SCHEMA,
            outputSchema: methodSchema?.outputSchema || null
          }),
          permission: methodPermission
        })
      );
    }
  }

  return Object.freeze(entries.sort((left, right) => left.descriptor.name.localeCompare(right.descriptor.name)));
}

function createServiceToolCatalog(
  scope,
  { barredServiceMethods = [], skipServicePrefixes = [], requireMethodSchemas = false } = {}
) {
  if (!scope || typeof scope.make !== "function") {
    throw new Error("createServiceToolCatalog requires container scope.make().");
  }

  const normalizedSkipPrefixes = (Array.isArray(skipServicePrefixes) ? skipServicePrefixes : [skipServicePrefixes])
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  const methodEntries = resolveServiceMethodEntries(scope, {
    barredServiceMethods,
    skipServicePrefixes: normalizedSkipPrefixes,
    requireMethodSchemas
  });

  function resolveToolSet(context = {}) {
    const tools = [];
    const byName = new Map();
    for (const entry of methodEntries) {
      if (!canInvokeMethod(entry.permission, context)) {
        continue;
      }

      tools.push(entry.descriptor);
      byName.set(entry.descriptor.name, entry.descriptor);
    }

    return Object.freeze({
      tools: Object.freeze(tools),
      byName
    });
  }

  function toOpenAiToolSchema(tool) {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    };
  }

  async function executeToolCall({ toolName = "", argumentsText = "", context = {}, toolSet = null } = {}) {
    const normalizedToolName = normalizeText(toolName);
    const resolvedToolSet = toolSet && typeof toolSet === "object" ? toolSet : resolveToolSet(context);
    const descriptor = normalizedToolName ? resolvedToolSet.byName.get(normalizedToolName) : null;

    if (!descriptor) {
      return {
        ok: false,
        error: {
          code: "assistant_tool_unknown",
          message: "Unknown tool."
        }
      };
    }

    const service = scope.make(descriptor.serviceToken);
    const method = service?.[descriptor.methodName];
    if (typeof method !== "function") {
      return {
        ok: false,
        error: {
          code: "assistant_tool_missing",
          message: "Tool is unavailable."
        }
      };
    }

    const parsedArguments = parseToolArguments(argumentsText);
    const methodOptions = {
      ...normalizeObject(parsedArguments.options),
      context
    };

    try {
      const result = await method(...parsedArguments.args, methodOptions);
      return {
        ok: true,
        result
      };
    } catch (error) {
      const status = Number(error?.status || error?.statusCode || 500);
      return {
        ok: false,
        error: {
          code: String(error?.code || "assistant_tool_failed").trim() || "assistant_tool_failed",
          message: status >= 500 ? "Tool call failed." : String(error?.message || "Tool call failed."),
          status: Number.isInteger(status) ? status : 500
        }
      };
    }
  }

  return Object.freeze({
    resolveToolSet,
    toOpenAiToolSchema,
    executeToolCall
  });
}

export { createServiceToolCatalog };
