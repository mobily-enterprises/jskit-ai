import { requireAuth } from "@jskit-ai/kernel/server/runtime";
import { resolveActionContributors } from "@jskit-ai/kernel/server/actions";
import { mergeValidators } from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspaceSlug } from "./resolveWorkspaceSlug.js";

const AUTOMATION_CHANNEL = "automation";

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

function parseToolPayload(argumentsText) {
  const source = String(argumentsText || "").trim();
  if (!source) {
    return {};
  }

  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    if (Array.isArray(parsed.args) || Object.hasOwn(parsed, "options")) {
      const args = Array.isArray(parsed.args) ? parsed.args : [];
      const options = parsed.options && typeof parsed.options === "object" && !Array.isArray(parsed.options)
        ? parsed.options
        : {};

      if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
        return {
          ...args[0],
          ...options
        };
      }

      return {
        args,
        ...options
      };
    }

    return parsed;
  } catch {
    return {};
  }
}

function canInvokeMethod(permission, context) {
  const permissionSpec = normalizePermissionSpec(permission);

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

function normalizePermissionSpec(permission) {
  const source = permission && typeof permission === "object" && !Array.isArray(permission)
    ? permission
    : {};
  const requireMode = normalizeText(source.require || "none").toLowerCase();
  const permissions = Array.isArray(source.permissions) ? source.permissions : [];

  return Object.freeze({
    require: requireMode || "none",
    permissions,
    message: normalizeText(source.message),
    code: normalizeText(source.code)
  });
}

function toServiceMethodKey(serviceToken, methodName) {
  const token = normalizeText(serviceToken).toLowerCase();
  const method = normalizeText(methodName).toLowerCase();
  if (!token || !method) {
    return "";
  }
  return `${token}.${method}`;
}

function stripWorkspaceSlugFromSchema(schema, context = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }

  const workspaceSlug = resolveWorkspaceSlug(context);
  if (!workspaceSlug) {
    return schema;
  }

  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
    return schema;
  }

  if (!Object.hasOwn(schema.properties, "workspaceSlug")) {
    return schema;
  }

  const properties = { ...schema.properties };
  delete properties.workspaceSlug;

  const requiredSource = Array.isArray(schema.required) ? schema.required : [];
  const required = requiredSource.filter((entry) => entry !== "workspaceSlug");

  return {
    ...schema,
    properties,
    ...(Array.isArray(schema.required) ? { required } : {})
  };
}

function extractJsonSchema(validator) {
  if (Array.isArray(validator)) {
    try {
      const merged = mergeValidators(validator, {
        context: "assistant tool validator",
        requireSchema: false
      });
      return extractJsonSchema(merged);
    } catch {
      return null;
    }
  }

  if (!validator || typeof validator !== "object" || Array.isArray(validator)) {
    return null;
  }

  const schema = validator.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }

  return schema;
}

function hasAutomationChannel(action = {}) {
  const channels = Array.isArray(action.channels) ? action.channels : [];
  return channels.some((channel) => normalizeText(channel).toLowerCase() === AUTOMATION_CHANNEL);
}

function resolveActionBackedMethodSchemas(scope) {
  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function") {
    return new Map();
  }
  if (typeof scope.resolveTag !== "function") {
    return new Map();
  }

  const entries = new Map();
  const contributors = resolveActionContributors(scope);

  for (const contributor of contributors) {
    const actions = Array.isArray(contributor?.actions) ? contributor.actions : [];
    for (const action of actions) {
      if (!action || typeof action !== "object") {
        continue;
      }
      if (!hasAutomationChannel(action)) {
        continue;
      }

      const bindings = Array.isArray(action.serviceMethodBindings) ? action.serviceMethodBindings : [];
      if (bindings.length < 1) {
        continue;
      }

      const assistantTool = action.assistantTool && typeof action.assistantTool === "object" ? action.assistantTool : null;
      const inputSchema = extractJsonSchema(assistantTool?.inputValidator) || extractJsonSchema(action.inputValidator);
      const outputSchema = extractJsonSchema(action.outputValidator);
      const description = normalizeText(assistantTool?.description) || `Call ${String(action.id || "").trim()}.`;

      for (const binding of bindings) {
        const key = toServiceMethodKey(binding?.serviceToken, binding?.methodName);
        if (!key) {
          continue;
        }

        const nextEntry = Object.freeze({
          serviceToken: String(binding.serviceToken || "").trim(),
          methodName: String(binding.methodName || "").trim(),
          key: `${String(binding.serviceToken || "").trim()}.${String(binding.methodName || "").trim()}`,
          description,
          inputSchema,
          outputSchema,
          actionId: String(action.id || "").trim() || null,
          actionVersion: Number(action.version) || 1,
          permission: normalizePermissionSpec(action.permission)
        });
        const existing = entries.get(key);
        if (!existing || Number(action.version) >= Number(existing.version || 0)) {
          entries.set(
            key,
            Object.freeze({
              ...nextEntry,
              version: Number(action.version) || 1
            })
          );
        }
      }
    }
  }

  return entries;
}

function resolveServiceMethodEntries(
  scope,
  { barredServiceMethods = [], skipServicePrefixes = [] } = {}
) {
  const actionBackedSchemas = resolveActionBackedMethodSchemas(scope);
  const barredSet = normalizeBarredMethodSet(barredServiceMethods);
  const usedToolNames = new Set();
  const entries = [];

  for (const actionBackedMethodSchema of actionBackedSchemas.values()) {
    const serviceToken = normalizeText(actionBackedMethodSchema?.serviceToken);
    if (!serviceToken) {
      continue;
    }

    const normalizedToken = serviceToken.toLowerCase();
    const skipByPrefix = skipServicePrefixes.some((prefix) => normalizedToken.startsWith(prefix));
    if (skipByPrefix) {
      continue;
    }

    const methodName = normalizeText(actionBackedMethodSchema?.methodName);
    if (!methodName) {
      continue;
    }

    if (isMethodBarred(barredSet, serviceToken, methodName)) {
      continue;
    }

    const inputSchema = actionBackedMethodSchema?.inputSchema || null;
    const outputSchema = actionBackedMethodSchema?.outputSchema || null;
    const description = normalizeText(actionBackedMethodSchema?.description);
    const methodPermission = normalizePermissionSpec(actionBackedMethodSchema?.permission);
    const actionId = normalizeText(actionBackedMethodSchema?.actionId);

    if (!actionId || !inputSchema || !outputSchema) {
      continue;
    }
    const toolName = resolveUniqueToolName(`${serviceToken}_${methodName}`, usedToolNames);
    entries.push(
      Object.freeze({
        descriptor: Object.freeze({
          name: toolName,
          serviceToken,
          methodName,
          actionId,
          actionVersion: Number(actionBackedMethodSchema?.actionVersion) || null,
          description: description || `Call ${serviceToken}.${methodName}().`,
          parameters: inputSchema,
          outputSchema
        }),
        permission: methodPermission
      })
    );
  }

  return Object.freeze(entries.sort((left, right) => left.descriptor.name.localeCompare(right.descriptor.name)));
}

function createServiceToolCatalog(
  scope,
  { barredServiceMethods = [], skipServicePrefixes = [] } = {}
) {
  if (!scope || typeof scope.make !== "function") {
    throw new Error("createServiceToolCatalog requires container scope.make().");
  }

  const normalizedSkipPrefixes = (Array.isArray(skipServicePrefixes) ? skipServicePrefixes : [skipServicePrefixes])
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  let methodEntries = null;

  function resolveOrCreateMethodEntries() {
    if (methodEntries) {
      return methodEntries;
    }

    methodEntries = resolveServiceMethodEntries(scope, {
      barredServiceMethods,
      skipServicePrefixes: normalizedSkipPrefixes
    });
    return methodEntries;
  }

  function resolveToolSet(context = {}) {
    const tools = [];
    const byName = new Map();
    for (const entry of resolveOrCreateMethodEntries()) {
      if (!canInvokeMethod(entry.permission, context)) {
        continue;
      }

      const descriptor = Object.freeze({
        ...entry.descriptor,
        parameters: stripWorkspaceSlugFromSchema(entry.descriptor.parameters, context)
      });

      tools.push(descriptor);
      byName.set(descriptor.name, descriptor);
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

    if (!scope.has("actionExecutor")) {
      return {
        ok: false,
        error: {
          code: "assistant_tool_unavailable",
          message: "Tool executor is unavailable.",
          status: 500
        }
      };
    }
    const actionExecutor = scope.make("actionExecutor");
    if (!actionExecutor || typeof actionExecutor.execute !== "function") {
      return {
        ok: false,
        error: {
          code: "assistant_tool_unavailable",
          message: "Tool executor is unavailable.",
          status: 500
        }
      };
    }

    try {
      const actionInput = parseToolPayload(argumentsText);
      if (actionInput && typeof actionInput === "object" && !Array.isArray(actionInput)) {
        const workspaceSlug = resolveWorkspaceSlug(context, actionInput);
        if (workspaceSlug && !Object.hasOwn(actionInput, "workspaceSlug")) {
          actionInput.workspaceSlug = workspaceSlug;
        }
      }
      const executionContext = {
        ...context,
        channel: AUTOMATION_CHANNEL
      };

      const result = await actionExecutor.execute({
        actionId: descriptor.actionId,
        version: descriptor.actionVersion || null,
        input: actionInput,
        context: executionContext
      });
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
