import { requireAuth } from "@jskit-ai/kernel/server/runtime";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  resolveStructuredSchemaTransportSchema,
  validateSchemaPayload
} from "@jskit-ai/kernel/shared/validators";
import { resolveWorkspaceSlug } from "./resolveWorkspaceSlug.js";

const AUTOMATION_CHANNEL = "automation";
const DEFAULT_MAX_DIRECT_TOOLS = 32;
const MAX_ALWAYS_AVAILABLE_TOOLS = 8;
const MAX_PREFLIGHT_INTENTS_PER_TOOL = 8;
const DEFAULT_DISCOVERY_PAGE_SIZE = 10;
const MAX_DISCOVERY_PAGE_SIZE = 20;
const DEFAULT_MAX_TOOL_ARGUMENT_BYTES = 32 * 1024;
const DEFAULT_MAX_TOOL_RESULT_BYTES = 48 * 1024;
const DISCOVERY_TOOL_NAMES = Object.freeze({
  search: "assistant_action_search",
  contract: "assistant_action_contract",
  execute: "assistant_action_execute"
});

const OPEN_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true
});

const ACTION_SEARCH_PARAMETERS = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      maxLength: 200,
      description: "Optional literal words or action-id fragments; every word must match. Use short resource or operation terms such as list. Omit query to browse all available actions."
    },
    cursor: {
      type: "string",
      maxLength: 1000,
      description: "Opaque cursor returned by the previous search page."
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_DISCOVERY_PAGE_SIZE,
      description: "Maximum compact matches to return."
    }
  }
});

const ACTION_SEARCH_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["items", "nextCursor", "total"],
  properties: {
    items: {
      type: "array",
      maxItems: MAX_DISCOVERY_PAGE_SIZE,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["actionId", "version", "kind", "description"],
        properties: {
          actionId: { type: "string" },
          version: { type: "integer", minimum: 1 },
          kind: { type: "string" },
          description: { type: "string" }
        }
      }
    },
    nextCursor: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    total: { type: "integer", minimum: 0 }
  }
});

const ACTION_CONTRACT_PARAMETERS = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["actionId"],
  properties: {
    actionId: { type: "string", minLength: 1, maxLength: 300 },
    version: { type: "integer", minimum: 1 }
  }
});

const ACTION_CONTRACT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["actionId", "version", "kind", "description", "inputSchema", "outputSchema"],
  properties: {
    actionId: { type: "string" },
    version: { type: "integer", minimum: 1 },
    kind: { type: "string" },
    description: { type: "string" },
    inputSchema: OPEN_OBJECT_SCHEMA,
    outputSchema: OPEN_OBJECT_SCHEMA
  }
});

const ACTION_EXECUTE_PARAMETERS = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["actionId", "input"],
  properties: {
    actionId: { type: "string", minLength: 1, maxLength: 300 },
    version: { type: "integer", minimum: 1 },
    input: OPEN_OBJECT_SCHEMA
  }
});

const ACTION_EXECUTE_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["actionId", "version", "result"],
  properties: {
    actionId: { type: "string" },
    version: { type: "integer", minimum: 1 },
    result: {}
  }
});

const DISCOVERY_TOOL_DESCRIPTORS = Object.freeze([
  Object.freeze({
    name: DISCOVERY_TOOL_NAMES.search,
    description: "Discover application actions available to the current user and surface, including list, search, and query operations for multiple records. Search before claiming a capability is unavailable. If terminology does not match, use broader terms or omit query to browse. Returns compact paged matches without schemas; follow nextCursor when more discovery is needed.",
    parameters: ACTION_SEARCH_PARAMETERS,
    outputSchema: ACTION_SEARCH_OUTPUT_SCHEMA
  }),
  Object.freeze({
    name: DISCOVERY_TOOL_NAMES.contract,
    description: "Load the exact input and output contract for one available action before executing it.",
    parameters: ACTION_CONTRACT_PARAMETERS,
    outputSchema: ACTION_CONTRACT_OUTPUT_SCHEMA
  }),
  Object.freeze({
    name: DISCOVERY_TOOL_NAMES.execute,
    description: "Execute one available action after loading its exact contract in this turn. The action result is returned in result.",
    parameters: ACTION_EXECUTE_PARAMETERS,
    outputSchema: ACTION_EXECUTE_OUTPUT_SCHEMA
  })
]);

function normalizePreflightIntents(value) {
  const source = Array.isArray(value) ? value : [value];
  const normalized = source
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  return Object.freeze([...new Set(normalized)].slice(0, MAX_PREFLIGHT_INTENTS_PER_TOOL));
}

function normalizeAssistantExtension(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (source.transformResult != null && typeof source.transformResult !== "function") {
    throw new TypeError("extensions.assistant.transformResult must be a function when provided.");
  }

  return Object.freeze({
    description: normalizeText(source.description),
    alwaysAvailable: source.alwaysAvailable === true,
    preflight: normalizePreflightIntents(source.preflight),
    output: Object.hasOwn(source, "output") ? source.output : null,
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

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function serializedByteLength(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return Buffer.byteLength("null", "utf8");
  }
  return Buffer.byteLength(serialized, "utf8");
}

function createToolError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  return error;
}

function ensureSerializedSize(value, maxBytes, { code = "assistant_tool_result_too_large", label = "Tool result" } = {}) {
  let byteLength = 0;
  try {
    byteLength = serializedByteLength(value);
  } catch {
    throw createToolError(500, "assistant_tool_result_unserializable", "Tool result could not be serialized.");
  }

  if (byteLength > maxBytes) {
    throw createToolError(
      413,
      code,
      `${label} exceeds the assistant size limit. Narrow the request and try again.`
    );
  }
}

function ensureToolArgumentsSize(argumentsText, maxBytes) {
  const source = String(argumentsText || "");
  if (Buffer.byteLength(source, "utf8") > maxBytes) {
    throw createToolError(
      413,
      "assistant_tool_arguments_too_large",
      "Tool arguments exceed the assistant size limit. Narrow the request and try again."
    );
  }
}

function normalizeActionLookupKey(actionId, version) {
  const normalizedActionId = normalizeText(actionId).toLowerCase();
  const normalizedVersion = Number(version);
  if (!normalizedActionId || !Number.isInteger(normalizedVersion) || normalizedVersion < 1) {
    return "";
  }
  return `${normalizedActionId}@${normalizedVersion}`;
}

function normalizeDiscoveryQuery(value) {
  return normalizeText(value).toLowerCase().slice(0, 200);
}

function encodeDiscoveryCursor(offset, query) {
  return Buffer.from(JSON.stringify({ v: 1, offset, query }), "utf8").toString("base64url");
}

function decodeDiscoveryCursor(value, query) {
  const normalizedCursor = normalizeText(value);
  if (!normalizedCursor) {
    return 0;
  }

  try {
    const parsed = JSON.parse(Buffer.from(normalizedCursor, "base64url").toString("utf8"));
    if (
      parsed?.v !== 1 ||
      normalizeDiscoveryQuery(parsed?.query) !== query ||
      !Number.isInteger(parsed?.offset) ||
      parsed.offset < 0
    ) {
      throw new Error("invalid cursor");
    }
    return parsed.offset;
  } catch {
    throw createToolError(400, "assistant_action_cursor_invalid", "Action search cursor is invalid for this query.");
  }
}

function truncateDescription(value, maxLength = 240) {
  const description = normalizeText(value);
  if (description.length <= maxLength) {
    return description;
  }
  return `${description.slice(0, Math.max(1, maxLength - 1))}…`;
}

function resolveValidationFailureMessage(error) {
  const baseMessage = normalizeText(error?.message, { fallback: "Validation failed." });
  if (normalizeText(error?.code).toUpperCase() !== "ACTION_VALIDATION_FAILED") {
    return baseMessage;
  }

  const fieldErrors = error?.details?.fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object" || Array.isArray(fieldErrors)) {
    return baseMessage;
  }

  const details = Object.entries(fieldErrors)
    .map(([field, message]) => [normalizeText(field), truncateDescription(message, 300)])
    .filter(([field, message]) => field && message)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 8)
    .map(([field, message]) => `${field}: ${message}`);
  return details.length > 0 ? `${baseMessage} ${details.join(" ")}` : baseMessage;
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

function canUseToolOnSurface(entry = {}, context = {}) {
  const toolSurfaces = Array.isArray(entry.surfaces) ? entry.surfaces : [];
  if (toolSurfaces.length < 1) {
    return true;
  }

  const contextSurfaceId = normalizeSurfaceId(context?.surface);
  if (!contextSurfaceId) {
    return true;
  }

  return toolSurfaces.includes(contextSurfaceId);
}

function resolveActionBackedToolEntries(actions) {
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

    const outputDefinition = assistantExtension.output || action.output;
    const inputSchema = resolveStructuredSchemaTransportSchema(action.input, {
      context: `Action definition "${actionId}" input`,
      defaultMode: "patch"
    }) || null;
    const outputSchema = resolveStructuredSchemaTransportSchema(outputDefinition, {
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
      preflight: assistantExtension.preflight,
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
          preflight: actionEntry.preflight,
          parameters: actionEntry.inputSchema,
          outputSchema: actionEntry.outputSchema
        }),
        kind: actionEntry.kind,
        outputDefinition: actionEntry.outputDefinition,
        transformResult: actionEntry.transformResult,
        permission: actionEntry.permission,
        surfaces: actionEntry.surfaces
      })
    );
  }

  return Object.freeze(entries.sort((left, right) => left.descriptor.name.localeCompare(right.descriptor.name)));
}

function createServiceToolCatalog(
  actions,
  {
    barredActionIds = [],
    skipActionPrefixes = [],
    maxDirectTools: rawMaxDirectTools = DEFAULT_MAX_DIRECT_TOOLS,
    discoveryPageSize: rawDiscoveryPageSize = DEFAULT_DISCOVERY_PAGE_SIZE,
    maxToolArgumentBytes: rawMaxToolArgumentBytes = DEFAULT_MAX_TOOL_ARGUMENT_BYTES,
    maxToolResultBytes: rawMaxToolResultBytes = DEFAULT_MAX_TOOL_RESULT_BYTES
  } = {}
) {
  if (!actions || typeof actions.listDefinitions !== "function" || typeof actions.execute !== "function") {
    throw new TypeError("createServiceToolCatalog requires runtime.actions.");
  }

  const normalizedSkipPrefixes = (Array.isArray(skipActionPrefixes) ? skipActionPrefixes : [skipActionPrefixes])
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  const maxDirectTools = normalizeNonNegativeInteger(rawMaxDirectTools, DEFAULT_MAX_DIRECT_TOOLS);
  const discoveryPageSize = Math.min(
    MAX_DISCOVERY_PAGE_SIZE,
    normalizePositiveInteger(rawDiscoveryPageSize, DEFAULT_DISCOVERY_PAGE_SIZE)
  );
  const maxToolArgumentBytes = normalizePositiveInteger(
    rawMaxToolArgumentBytes,
    DEFAULT_MAX_TOOL_ARGUMENT_BYTES
  );
  const maxToolResultBytes = normalizePositiveInteger(rawMaxToolResultBytes, DEFAULT_MAX_TOOL_RESULT_BYTES);
  const toolSetStates = new WeakMap();
  let methodEntries = null;

  function resolveOrCreateMethodEntries() {
    if (methodEntries) {
      return methodEntries;
    }

    methodEntries = resolveActionToolEntries(actions, {
      barredActionIds,
      skipActionPrefixes: normalizedSkipPrefixes
    });
    return methodEntries;
  }

  function resolveAuthorizedEntries(context = {}) {
    const entries = [];
    for (const entry of resolveOrCreateMethodEntries()) {
      if (!canUseToolOnSurface(entry, context)) {
        continue;
      }
      if (!canInvokeMethod(entry.permission, context)) {
        continue;
      }

      entries.push(Object.freeze({
        ...entry,
        descriptor: Object.freeze({
          ...entry.descriptor,
          parameters: stripWorkspaceSlugFromSchema(entry.descriptor.parameters, context)
        })
      }));
    }

    return Object.freeze(entries.sort((left, right) => left.descriptor.actionId.localeCompare(right.descriptor.actionId)));
  }

  function resolveToolSet(context = {}) {
    const actionEntries = resolveAuthorizedEntries(context);
    const useDiscovery = actionEntries.length > maxDirectTools;
    const alwaysAvailableEntries = useDiscovery
      ? actionEntries
          .filter((entry) => entry.descriptor.alwaysAvailable === true)
          .filter((entry) => !Object.values(DISCOVERY_TOOL_NAMES).includes(entry.descriptor.name))
          .slice(0, MAX_ALWAYS_AVAILABLE_TOOLS)
      : [];
    const alwaysAvailableEntrySet = new Set(alwaysAvailableEntries);
    const tools = useDiscovery
      ? [
          ...DISCOVERY_TOOL_DESCRIPTORS,
          ...alwaysAvailableEntries.map((entry) => entry.descriptor)
        ]
      : actionEntries.map((entry) => entry.descriptor);
    const byName = new Map();
    for (const descriptor of tools) {
      byName.set(descriptor.name, descriptor);
    }

    const toolSet = Object.freeze({
      tools: Object.freeze(tools),
      byName
    });
    const actionEntriesById = new Map();
    const directEntriesByToolName = new Map();
    for (const entry of actionEntries) {
      actionEntriesById.set(entry.descriptor.actionId.toLowerCase(), entry);
      if (!useDiscovery || alwaysAvailableEntrySet.has(entry)) {
        directEntriesByToolName.set(entry.descriptor.name, entry);
      }
    }
    toolSetStates.set(toolSet, {
      mode: useDiscovery ? "discovery" : "direct",
      actionEntries,
      actionEntriesById,
      directEntriesByToolName,
      contractedActionKeys: new Set()
    });
    return toolSet;
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

  function requireActionEntry(state, payload = {}) {
    const actionId = normalizeText(payload.actionId);
    const entry = actionId ? state.actionEntriesById.get(actionId.toLowerCase()) : null;
    const requestedVersion = payload.version == null ? null : Number(payload.version);
    if (
      !entry ||
      (requestedVersion != null && requestedVersion !== Number(entry.descriptor.actionVersion))
    ) {
      throw createToolError(404, "assistant_action_unknown", "Action is not available.");
    }
    return entry;
  }

  function searchActionEntries(state, payload = {}) {
    const query = normalizeDiscoveryQuery(payload.query);
    const terms = query.split(/\s+/u).filter(Boolean);
    const matches = terms.length < 1
      ? state.actionEntries
      : state.actionEntries.filter((entry) => {
          const searchable = [
            entry.descriptor.actionId,
            entry.kind,
            entry.descriptor.description
          ].join(" ").toLowerCase();
          return terms.every((term) => searchable.includes(term));
        });
    const offset = decodeDiscoveryCursor(payload.cursor, query);
    const requestedLimit = normalizePositiveInteger(payload.limit, discoveryPageSize);
    const limit = Math.min(MAX_DISCOVERY_PAGE_SIZE, requestedLimit);
    const page = matches.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const result = {
      items: page.map((entry) => ({
        actionId: entry.descriptor.actionId,
        version: entry.descriptor.actionVersion,
        kind: entry.kind,
        description: truncateDescription(entry.descriptor.description)
      })),
      nextCursor: nextOffset < matches.length ? encodeDiscoveryCursor(nextOffset, query) : null,
      total: matches.length
    };
    ensureSerializedSize(result, maxToolResultBytes);
    return result;
  }

  function resolveActionContract(state, payload = {}) {
    const entry = requireActionEntry(state, payload);
    const contract = {
      actionId: entry.descriptor.actionId,
      version: entry.descriptor.actionVersion,
      kind: entry.kind,
      description: entry.descriptor.description,
      inputSchema: entry.descriptor.parameters,
      outputSchema: entry.descriptor.outputSchema
    };
    ensureSerializedSize(contract, maxToolResultBytes, {
      code: "assistant_tool_contract_too_large",
      label: "Action contract"
    });
    state.contractedActionKeys.add(
      normalizeActionLookupKey(entry.descriptor.actionId, entry.descriptor.actionVersion)
    );
    return contract;
  }

  function createActionInput(value, context = {}) {
    const actionInput = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
    const trustedWorkspaceSlug = resolveWorkspaceSlug(context);
    if (trustedWorkspaceSlug) {
      actionInput.workspaceSlug = trustedWorkspaceSlug;
    }
    return actionInput;
  }

  async function executeActionEntry(entry, input = {}, context = {}) {
    const actionInput = createActionInput(input, context);
    const executionContext = {
      ...context,
      channel: AUTOMATION_CHANNEL
    };
    const rawResult = await actions.execute({
      actionId: entry.descriptor.actionId,
      version: entry.descriptor.actionVersion || null,
      input: actionInput,
      context: executionContext
    });
    const transformedResult = entry.transformResult
      ? await entry.transformResult(rawResult, Object.freeze({
          actionId: entry.descriptor.actionId,
          version: entry.descriptor.actionVersion,
          input: Object.freeze({ ...actionInput }),
          context: executionContext
        }))
      : rawResult;

    let result = transformedResult;
    try {
      result = validateSchemaPayload(entry.outputDefinition, transformedResult, {
        phase: "output",
        context: `Assistant tool "${entry.descriptor.actionId}" output`
      });
    } catch {
      throw createToolError(500, "assistant_tool_output_invalid", "Assistant tool output validation failed.");
    }
    ensureSerializedSize(result, maxToolResultBytes);
    return result;
  }

  async function executeDiscoveredAction(state, payload = {}, context = {}) {
    const entry = requireActionEntry(state, payload);
    const actionKey = normalizeActionLookupKey(entry.descriptor.actionId, entry.descriptor.actionVersion);
    if (!state.contractedActionKeys.has(actionKey)) {
      throw createToolError(
        409,
        "assistant_action_contract_required",
        "Load this action's exact contract before executing it."
      );
    }
    const result = await executeActionEntry(entry, payload.input, context);
    const response = {
      actionId: entry.descriptor.actionId,
      version: entry.descriptor.actionVersion,
      result
    };
    ensureSerializedSize(response, maxToolResultBytes);
    return response;
  }

  function resolveToolFailure(error) {
    const status = Number(error?.status || error?.statusCode || 500);
    return {
      ok: false,
      error: {
        code: String(error?.code || "assistant_tool_failed").trim() || "assistant_tool_failed",
        message: status >= 500 ? "Tool call failed." : resolveValidationFailureMessage(error),
        status: Number.isInteger(status) ? status : 500
      }
    };
  }

  async function executeToolCall({ toolName = "", argumentsText = "", context = {}, toolSet = null } = {}) {
    const normalizedToolName = normalizeText(toolName);
    const suppliedState = toolSet && typeof toolSet === "object" ? toolSetStates.get(toolSet) : null;
    const resolvedToolSet = suppliedState ? toolSet : resolveToolSet(context);
    const state = suppliedState || toolSetStates.get(resolvedToolSet);
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

    try {
      ensureToolArgumentsSize(argumentsText, maxToolArgumentBytes);
      const payload = parseToolPayload(argumentsText);
      if (state.mode === "discovery") {
        if (normalizedToolName === DISCOVERY_TOOL_NAMES.search) {
          return { ok: true, result: searchActionEntries(state, payload) };
        }
        if (normalizedToolName === DISCOVERY_TOOL_NAMES.contract) {
          return { ok: true, result: resolveActionContract(state, payload) };
        }
        if (normalizedToolName === DISCOVERY_TOOL_NAMES.execute) {
          return { ok: true, result: await executeDiscoveredAction(state, payload, context) };
        }
      }

      const entry = state.directEntriesByToolName.get(normalizedToolName);
      if (!entry) {
        throw createToolError(404, "assistant_tool_unknown", "Unknown tool.");
      }
      const result = await executeActionEntry(entry, payload, context);
      return {
        ok: true,
        result
      };
    } catch (error) {
      return resolveToolFailure(error);
    }
  }

  return Object.freeze({
    resolveToolSet,
    toOpenAiToolSchema,
    executeToolCall
  });
}

export { createServiceToolCatalog };
