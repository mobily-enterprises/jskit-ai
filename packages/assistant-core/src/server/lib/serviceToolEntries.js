import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";

// Which application actions become assistant tools: an action on the automation channel with
// input and output schemas, minus the barred and excluded ones, each under one unique tool name.

const AUTOMATION_CHANNEL = "automation";

function normalizeAssistantExtension(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  // readable-check: allow method-probe - input validation: an action's assistant extension may bring its own result transform
  if (source.transformResult != null && typeof source.transformResult !== "function") {
    throw new TypeError("extensions.assistant.transformResult must be a function when provided.");
  }

  return Object.freeze({
    description: normalizeText(source.description),
    exclude: normalizeText(source.exclude),
    alwaysAvailable: source.alwaysAvailable === true,
    output: Object.hasOwn(source, "output") ? source.output : null,
    // readable-check: allow method-probe - input validation: an action's assistant extension may bring its own result transform
    transformResult: typeof source.transformResult === "function" ? source.transformResult : null
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

function hasAutomationChannel(action = {}) {
  const channels = Array.isArray(action.channels) ? action.channels : [];
  return channels.some((channel) => normalizeText(channel).toLowerCase() === AUTOMATION_CHANNEL);
}

function normalizeSurfaceList(value) {
  const source = Array.isArray(value) ? value : [value];
  const resolved = [];

  for (const entry of source) {
    const normalized = normalizeSurfaceId(entry);
    if (normalized) {
      resolved.push(normalized);
    }
  }

  return Object.freeze(resolved);
}

function resolveActionBackedToolEntries(actions) {
  // readable-check: allow method-probe - input validation: the application passes its action runtime
  if (!actions || typeof actions.listDefinitions !== "function") {
    throw new TypeError("Assistant tool catalog requires runtime.actions.");
  }
  const entriesByActionId = new Map();
  for (const action of actions.listDefinitions()) {
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

    let assistantExtension = null;
    try {
      assistantExtension = normalizeAssistantActionExtension(action);
    } catch {
      continue;
    }

    if (assistantExtension.exclude) {
      continue;
    }

    const outputDefinition = assistantExtension.output || action.output;
    const inputSchema = resolveSchemaTransportSchemaDefinition(action.input, {
      context: `Action definition "${actionId}" input`,
      defaultMode: "patch"
    }) || null;
    const outputSchema = resolveSchemaTransportSchemaDefinition(outputDefinition, {
      context: `Action definition "${actionId}" assistant output`,
      defaultMode: "replace"
    }) || null;
    if (!inputSchema || !outputSchema) {
      continue;
    }

    const actionVersion = Number(action.version) || 1;
    const actionKey = actionId.toLowerCase();
    const nextEntry = Object.freeze({
      actionId,
      actionVersion,
      kind: normalizeText(action.kind).toLowerCase() || "command",
      toolBaseName: actionId,
      description: assistantExtension.description || `Run ${actionId}.`,
      alwaysAvailable: assistantExtension.alwaysAvailable,
      inputSchema,
      outputDefinition,
      outputSchema,
      transformResult: assistantExtension.transformResult,
      permission: normalizePermissionSpec(action.permission),
      surfaces: normalizeSurfaceList(action.surfaces)
    });
    const existing = entriesByActionId.get(actionKey);
    if (!existing || actionVersion >= Number(existing.actionVersion || 0)) {
      entriesByActionId.set(actionKey, nextEntry);
    }
  }

  return entriesByActionId;
}

function resolveActionToolEntries(
  actions,
  { barredActionIds = [], skipActionPrefixes = [] } = {}
) {
  const actionBackedEntries = resolveActionBackedToolEntries(actions);
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
          alwaysAvailable: actionEntry.alwaysAvailable === true,
          parameters: actionEntry.inputSchema,
          outputSchema: actionEntry.outputSchema
        }),
        kind: actionEntry.kind,
        acceptsWorkspaceSlug: Object.hasOwn(actionEntry.inputSchema.properties || {}, "workspaceSlug"),
        outputDefinition: actionEntry.outputDefinition,
        transformResult: actionEntry.transformResult,
        permission: actionEntry.permission,
        surfaces: actionEntry.surfaces
      })
    );
  }

  return Object.freeze(entries.sort((left, right) => left.descriptor.name.localeCompare(right.descriptor.name)));
}

export { AUTOMATION_CHANNEL, normalizePermissionSpec, resolveActionToolEntries };
