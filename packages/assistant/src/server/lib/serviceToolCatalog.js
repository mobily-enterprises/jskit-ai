import { requireAuth } from "@jskit-ai/kernel/server/runtime";
import { resolveActionContributors } from "@jskit-ai/kernel/server/actions";
import { normalizeActionDefinition } from "@jskit-ai/kernel/shared/actions";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspaceSlug } from "./resolveWorkspaceSlug.js";

const AUTOMATION_CHANNEL = "automation";

function normalizeAssistantExtension(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.freeze({
    description: normalizeText(source.description)
  });
}

function normalizeAssistantActionExtension(action = {}) {
  const source = action && typeof action === "object" && !Array.isArray(action) ? action : {};
  const actionId = normalizeText(source.id);

  if (Object.prototype.hasOwnProperty.call(source, "assistantTool")) {
    throw new Error(
      `Action definition \"${actionId || "<unknown>"}\" assistantTool is not supported. Use extensions.assistant instead.`
    );
  }

  const extensions = source.extensions && typeof source.extensions === "object" && !Array.isArray(source.extensions)
    ? source.extensions
    : {};
  return normalizeAssistantExtension(extensions.assistant);
}

function normalizeBarredEntry(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeBarredActionSet(value) {
  const source = Array.isArray(value) ? value : [value];
  const exact = new Set();
  const prefixes = [];

  for (const entry of source) {
    const normalized = normalizeBarredEntry(entry);
    if (!normalized) {
      continue;
    }

    if (normalized.endsWith(".*")) {
      const prefix = normalized.slice(0, -1);
      if (prefix) {
        prefixes.push(prefix);
      }
      continue;
    }

    exact.add(normalized);
  }

  return Object.freeze({
    exact,
    prefixes: Object.freeze(prefixes)
  });
}

function isActionBarred(barredRules, actionId) {
  const normalizedActionId = normalizeText(actionId).toLowerCase();
  if (!normalizedActionId) {
    return true;
  }

  if (barredRules.exact.has(normalizedActionId)) {
    return true;
  }

  return barredRules.prefixes.some((prefix) => normalizedActionId.startsWith(prefix));
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
  const normalizedBase = sanitizeToolName(baseName) || "tool";
  let candidate = normalizedBase.slice(0, 64);
  let suffix = 1;

  while (used.has(candidate)) {
    const suffixText = `_${suffix}`;
    const baseBudget = Math.max(1, 64 - suffixText.length);
    candidate = `${normalizedBase.slice(0, baseBudget)}${suffixText}`;
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

function hasAutomationChannel(action = {}) {
  const channels = Array.isArray(action.channels) ? action.channels : [];
  return channels.some((channel) => normalizeText(channel).toLowerCase() === AUTOMATION_CHANNEL);
}

function resolveActionBackedToolEntries(scope) {
  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function") {
    return new Map();
  }
  if (typeof scope.resolveTag !== "function") {
    return new Map();
  }

  const entriesByActionId = new Map();
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

      const actionId = normalizeText(action.id);
      if (!actionId) {
        continue;
      }

      let normalizedAction = null;
      let assistantExtension = null;
      try {
        assistantExtension = normalizeAssistantActionExtension(action);
        normalizedAction = normalizeActionDefinition(action, {
          contributorDomain: action.domain
        });
      } catch {
        continue;
      }

      const inputSchema = normalizedAction.inputValidator?.schema || null;
      const outputSchema = normalizedAction.outputValidator?.schema || null;
      if (!inputSchema || !outputSchema) {
        continue;
      }

      const actionVersion = Number(normalizedAction.version) || 1;
      const actionKey = actionId.toLowerCase();
      const nextEntry = Object.freeze({
        actionId,
        actionVersion,
        toolBaseName: actionId,
        description: assistantExtension.description || `Run ${actionId}.`,
        inputSchema,
        outputSchema,
        permission: normalizePermissionSpec(normalizedAction.permission)
      });
      const existing = entriesByActionId.get(actionKey);
      if (!existing || actionVersion >= Number(existing.actionVersion || 0)) {
        entriesByActionId.set(actionKey, nextEntry);
      }
    }
  }

  return entriesByActionId;
}

function resolveActionToolEntries(
  scope,
  { barredActionIds = [], skipActionPrefixes = [] } = {}
) {
  const actionBackedEntries = resolveActionBackedToolEntries(scope);
  const barredRules = normalizeBarredActionSet(barredActionIds);
  const usedToolNames = new Set();
  const entries = [];

  for (const actionEntry of actionBackedEntries.values()) {
    const actionId = normalizeText(actionEntry?.actionId);
    if (!actionId) {
      continue;
    }

    const normalizedActionId = actionId.toLowerCase();
    const skipByPrefix = skipActionPrefixes.some((prefix) => normalizedActionId.startsWith(prefix));
    if (skipByPrefix) {
      continue;
    }

    if (isActionBarred(barredRules, actionId)) {
      continue;
    }

    const toolName = resolveUniqueToolName(actionEntry.toolBaseName, usedToolNames);
    entries.push(
      Object.freeze({
        descriptor: Object.freeze({
          name: toolName,
          actionId,
          actionVersion: Number(actionEntry.actionVersion) || null,
          description: normalizeText(actionEntry.description) || `Run ${actionId}.`,
          parameters: actionEntry.inputSchema,
          outputSchema: actionEntry.outputSchema
        }),
        permission: actionEntry.permission
      })
    );
  }

  return Object.freeze(entries.sort((left, right) => left.descriptor.name.localeCompare(right.descriptor.name)));
}

function createServiceToolCatalog(
  scope,
  { barredActionIds = [], skipActionPrefixes = [] } = {}
) {
  if (!scope || typeof scope.make !== "function") {
    throw new Error("createServiceToolCatalog requires container scope.make().");
  }

  const normalizedSkipPrefixes = (Array.isArray(skipActionPrefixes) ? skipActionPrefixes : [skipActionPrefixes])
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  let methodEntries = null;

  function resolveOrCreateMethodEntries() {
    if (methodEntries) {
      return methodEntries;
    }

    methodEntries = resolveActionToolEntries(scope, {
      barredActionIds,
      skipActionPrefixes: normalizedSkipPrefixes
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
