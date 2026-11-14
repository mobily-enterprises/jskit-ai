import { withoutExecutionLog } from "@jskit-ai/kernel/server/actions";
import { AppError, resolveApiErrorStatus } from "@jskit-ai/kernel/server/runtime/errors";
import { requireAuth } from "@jskit-ai/kernel/server/runtime";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizePositiveInteger, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { errorFieldErrors, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { resolveWorkspaceSlug } from "./resolveWorkspaceSlug.js";
import { AUTOMATION_CHANNEL, normalizePermissionSpec, resolveActionToolEntries } from "./serviceToolEntries.js";

const DEFAULT_MAX_DIRECT_TOOLS = 32;
const MAX_ALWAYS_AVAILABLE_TOOLS = 8;
// Why a tool set leaves out an unsaved action.
const UNSAVED_REFUSALS = Object.freeze({
  notOffered: "This assistant does not keep unsaved tool calls out of what it saves, so it is not offered here.",
  discoveryOnly: "Only the discovery tools are offered here, and an unsaved action is never discoverable.",
  directLimit: `At most ${MAX_ALWAYS_AVAILABLE_TOOLS} actions are offered directly beside action discovery.`
});
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

// Empty arguments mean "no input"; anything else must be one JSON object, so a
// truncated or malformed call fails instead of running the action with {}.
function parseToolPayload(argumentsText) {
  const source = String(argumentsText || "").trim();
  if (!source) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createToolError(400, "assistant_tool_arguments_invalid", "Tool arguments must be a JSON object.");
  }
  return parsed;
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function serializedByteLength(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return Buffer.byteLength("null", "utf8");
  }
  return Buffer.byteLength(serialized, "utf8");
}

function createToolError(status, code, message) {
  return new AppError(status, message, { code });
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

// A refusal's message, followed by its field errors when it is a validation error: the field errors the HTTP
// layer shows a person, whether the action's input check or the action itself refused.
function resolveValidationFailureMessage(error) {
  const baseMessage = normalizeText(error?.message, { fallback: "Validation failed." });
  const fieldErrors = errorFieldErrors(error)?.fieldErrors;
  if (!fieldErrors) {
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

function isJsonRestApiError(error) {
  return /^RestApi/u.test(String(error?.name || "")) || /^REST_API_/u.test(String(error?.code || ""));
}

// The refusal whose message a failed tool call may give the model, which relays it to people: the failure itself, or
// the error the application raised with its own status inside json-rest-api's wrapper. json-rest-api's own errors
// (its RestApi* classes and REST_API_* codes), and an error that copies one's message (a sparse-fieldset refusal
// mapped to a 400), speak developer English naming internal resource types and record ids, so they have none: the
// model gets their status and "Tool call failed.". So does a database error json-rest-api wraps, which has no status.
function applicationRefusal(error) {
  const seen = new Set();
  for (let current = error; current && typeof current === "object" && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (isJsonRestApiError(current)) {
      continue;
    }
    const copiesJsonRestApi = isJsonRestApiError(current.cause) && current.message === current.cause.message;
    const status = Number(current.status || current.statusCode);
    return !copiesJsonRestApi && (current === error || (status >= 400 && status < 500)) ? current : null;
  }
  return null;
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

function canUseToolOnSurface(entry = {}, context = {}) {
  const toolSurfaces = Array.isArray(entry.surfaces) ? entry.surfaces : [];
  if (toolSurfaces.length < 1) {
    return true;
  }

  // readable-check: allow no-optional-after-default - input validation: a caller may pass a null context
  const contextSurfaceId = normalizeSurfaceId(context?.surface);
  if (!contextSurfaceId) {
    return true;
  }

  return toolSurfaces.includes("*") || toolSurfaces.includes(contextSurfaceId);
}

// A tool call whose caller does not watch its failures.
function reportNoToolFailure() {}

/**
 * The assistant tools an application's actions offer one caller: direct tools, or discovery
 * tools when there are too many, each checked against permission, surface and policy.
 * @param {{ listDefinitions(): object[], execute(request: object): Promise<unknown> }} actions The application's action runtime.
 * @param {object} [options]
 * @param {(request: { actionId: string, kind: string, context: object }) => boolean} [options.isActionAvailable]
 * @param {string[] | string} [options.barredActionIds]
 * @param {string[] | string} [options.skipActionPrefixes]
 * @param {number} [options.maxDirectTools]
 * @param {number} [options.discoveryPageSize]
 * @param {number} [options.maxToolArgumentBytes]
 * @param {number} [options.maxToolResultBytes]
 */
function createServiceToolCatalog(
  actions,
  {
    isActionAvailable,
    barredActionIds = [],
    skipActionPrefixes = [],
    maxDirectTools: rawMaxDirectTools = DEFAULT_MAX_DIRECT_TOOLS,
    discoveryPageSize: rawDiscoveryPageSize = DEFAULT_DISCOVERY_PAGE_SIZE,
    maxToolArgumentBytes: rawMaxToolArgumentBytes = DEFAULT_MAX_TOOL_ARGUMENT_BYTES,
    maxToolResultBytes: rawMaxToolResultBytes = DEFAULT_MAX_TOOL_RESULT_BYTES
  } = {}
) {
  // readable-check: allow method-probe - input validation: the application passes its action runtime
  if (!actions || typeof actions.listDefinitions !== "function" || typeof actions.execute !== "function") {
    throw new TypeError("createServiceToolCatalog requires runtime.actions.");
  }
  // readable-check: allow method-probe - input validation: an optional action policy must be a function
  if (isActionAvailable !== undefined && typeof isActionAvailable !== "function") {
    throw new TypeError("isActionAvailable must be a synchronous action policy.");
  }

  const normalizedSkipPrefixes = (Array.isArray(skipActionPrefixes) ? skipActionPrefixes : [skipActionPrefixes])
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  const maxDirectTools = normalizeNonNegativeInteger(rawMaxDirectTools, DEFAULT_MAX_DIRECT_TOOLS);
  const discoveryPageSize = Math.min(
    MAX_DISCOVERY_PAGE_SIZE,
    normalizePositiveInteger(rawDiscoveryPageSize, { fallback: DEFAULT_DISCOVERY_PAGE_SIZE })
  );
  const maxToolArgumentBytes = normalizePositiveInteger(rawMaxToolArgumentBytes, { fallback: DEFAULT_MAX_TOOL_ARGUMENT_BYTES });
  const maxToolResultBytes = normalizePositiveInteger(rawMaxToolResultBytes, { fallback: DEFAULT_MAX_TOOL_RESULT_BYTES });
  // Every tool set carries these, so the calls made with one surface's set keep that surface's limits.
  const limits = Object.freeze({ maxToolArgumentBytes, maxToolResultBytes });
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

  function actionAvailable(entry, context) {
    if (!canUseToolOnSurface(entry, context) || !canInvokeMethod(entry.permission, context)) return false;
    if (!isActionAvailable) return true;
    const allowed = isActionAvailable({ actionId: entry.descriptor.actionId, kind: entry.kind, context });
    if (typeof allowed !== "boolean") throw new TypeError("isActionAvailable must return a boolean.");
    return allowed;
  }

  function resolveAuthorizedEntries(context = {}) {
    const entries = [];
    for (const entry of resolveOrCreateMethodEntries()) {
      if (!actionAvailable(entry, context)) {
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

  /**
   * The tools one caller offers its model. An unsaved action is offered only when the caller keeps
   * its calls in the live turn (`offerUnsaved`), and only as a direct tool: through discovery its id,
   * input and result would ride in the discovery calls, which are saved. Otherwise the tool set lists
   * it in `withheld`, with the reason: `unsavedRefusal`, the caller's own, or the catalogue's.
   * @param {object} [context]
   * @param {{ discoveryOnly?: boolean, offerUnsaved?: boolean, unsavedRefusal?: string }} [options]
   */
  function resolveToolSet(context = {}, { discoveryOnly = false, offerUnsaved = false, unsavedRefusal = "" } = {}) {
    if (typeof offerUnsaved !== "boolean") throw new TypeError("offerUnsaved must be a boolean.");
    const authorizedEntries = resolveAuthorizedEntries(context);
    // Discovery searches, describes and runs only the actions whose calls may be saved.
    const actionEntries = authorizedEntries.filter((entry) => entry.descriptor.unsaved !== true);
    const unsavedEntries = offerUnsaved && !discoveryOnly
      ? authorizedEntries.filter((entry) => entry.descriptor.unsaved === true) : [];
    // The mode follows what this caller could be offered, so a withheld action never tips it into discovery.
    const useDiscovery = discoveryOnly || actionEntries.length + unsavedEntries.length > maxDirectTools;
    // Beside discovery, the unsaved actions come first among the few offered directly.
    const directBesideDiscovery = useDiscovery && !discoveryOnly
      ? [...unsavedEntries, ...actionEntries.filter((entry) => entry.descriptor.alwaysAvailable === true)]
          .filter((entry) => !Object.values(DISCOVERY_TOOL_NAMES).includes(entry.descriptor.name))
          .slice(0, MAX_ALWAYS_AVAILABLE_TOOLS)
      : [];
    const directEntries = useDiscovery
      ? directBesideDiscovery
      : authorizedEntries.filter((entry) => entry.descriptor.unsaved !== true || offerUnsaved);
    const directEntrySet = new Set(directEntries);
    const refusal = !offerUnsaved ? normalizeText(unsavedRefusal) || UNSAVED_REFUSALS.notOffered
      : discoveryOnly ? UNSAVED_REFUSALS.discoveryOnly : UNSAVED_REFUSALS.directLimit;
    const withheld = authorizedEntries
      .filter((entry) => entry.descriptor.unsaved === true && !directEntrySet.has(entry))
      .map((entry) => Object.freeze({ name: entry.descriptor.name, actionId: entry.descriptor.actionId, reason: refusal }));
    const tools = useDiscovery
      ? [
          ...DISCOVERY_TOOL_DESCRIPTORS,
          ...directBesideDiscovery.map((entry) => entry.descriptor)
        ]
      : directEntries.map((entry) => entry.descriptor);
    const byName = new Map();
    for (const descriptor of tools) {
      byName.set(descriptor.name, descriptor);
    }

    const toolSet = Object.freeze({
      tools: Object.freeze(tools),
      byName,
      withheld: Object.freeze(withheld),
      limits
    });
    const actionEntriesById = new Map();
    const directEntriesByToolName = new Map();
    for (const entry of actionEntries) {
      actionEntriesById.set(entry.descriptor.actionId.toLowerCase(), entry);
    }
    for (const entry of directEntries) {
      directEntriesByToolName.set(entry.descriptor.name, entry);
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
    const requestedLimit = normalizePositiveInteger(payload.limit, { fallback: discoveryPageSize });
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

  function createActionInput(entry, value, context = {}) {
    const actionInput = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
    const trustedWorkspaceSlug = resolveWorkspaceSlug(context);
    if (trustedWorkspaceSlug && entry.acceptsWorkspaceSlug) {
      actionInput.workspaceSlug = trustedWorkspaceSlug;
    }
    return actionInput;
  }

  async function executeActionEntry(entry, input = {}, context = {}) {
    if (!actionAvailable(entry, context)) throw createToolError(404, "assistant_action_unknown", "Action is not available.");
    const actionInput = createActionInput(entry, input, context);
    const automationContext = {
      ...context,
      channel: AUTOMATION_CHANNEL
    };
    // An unsaved call leaves no line in the action execution log either.
    const executionContext = entry.descriptor.unsaved ? withoutExecutionLog(automationContext) : automationContext;
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

  // The status the HTTP layer answers with, so a refusal json-rest-api throws without one (REST_API_VALIDATION) is a
  // refusal here too, not an internal failure. Its message is the application's refusal only (applicationRefusal).
  function resolveToolFailure(error) {
    const status = resolveApiErrorStatus(error);
    const refusal = status < 500 ? applicationRefusal(error) : null;
    return {
      ok: false,
      error: {
        code: String(error?.code || "assistant_tool_failed").trim() || "assistant_tool_failed",
        message: refusal ? resolveValidationFailureMessage(refusal) : "Tool call failed.",
        status
      }
    };
  }

  async function executeToolCall({ toolName = "", argumentsText = "", context = {}, toolSet = null, onFailure = reportNoToolFailure } = {}) {
    const normalizedToolName = normalizeText(toolName);
    const suppliedState = toolSet && typeof toolSet === "object" ? toolSetStates.get(toolSet) : null;
    const resolvedToolSet = suppliedState ? toolSet : resolveToolSet(context);
    let state = suppliedState || toolSetStates.get(resolvedToolSet);
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
        const actionEntries = state.actionEntries.filter(entry => actionAvailable(entry, context));
        state = { ...state, actionEntries,
          actionEntriesById: new Map(actionEntries.map(entry => [entry.descriptor.actionId.toLowerCase(), entry])) };
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
      onFailure(error);
      return resolveToolFailure(error);
    }
  }

  return Object.freeze({
    limits,
    resolveToolSet,
    toOpenAiToolSchema,
    executeToolCall
  });
}

export { createServiceToolCatalog, DEFAULT_MAX_TOOL_ARGUMENT_BYTES, DEFAULT_MAX_TOOL_RESULT_BYTES, DISCOVERY_TOOL_DESCRIPTORS };
