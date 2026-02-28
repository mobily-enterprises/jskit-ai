import { createHash } from "node:crypto";
import { buildAiToolRegistry, listToolSchemas } from "@jskit-ai/assistant-core";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { normalizeLowerText, normalizeText } from "@jskit-ai/action-runtime-core";

const ASSISTANT_TOOL_CHANNEL = "assistant_tool";
const TOOL_NAME_MAX_LENGTH = 64;
const DEFAULT_INPUT_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {}
});

function toLowerSet(values) {
  if (!Array.isArray(values)) {
    return new Set();
  }

  return new Set(values.map((entry) => normalizeLowerText(entry)).filter(Boolean));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeObject(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  return value;
}

function stableStringify(value) {
  const source = value && typeof value === "object" ? value : value == null ? null : value;
  if (source == null || typeof source !== "object") {
    return JSON.stringify(source);
  }

  if (Array.isArray(source)) {
    return `[${source.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.keys(source)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(source[key])}`);

  return `{${entries.join(",")}}`;
}

function createHashSuffix(value, length = 8) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, Math.max(4, Number(length) || 8));
}

function createBaseToolName(actionId) {
  const normalized = normalizeLowerText(actionId)
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const candidate = normalized || "action";
  if (/^[0-9]/.test(candidate)) {
    return `a_${candidate}`;
  }

  return candidate;
}

function createToolName(actionId, usedNames = new Map()) {
  const baseName = createBaseToolName(actionId);
  const baseHash = createHashSuffix(actionId, 10);
  const maxBaseLength = Math.max(16, TOOL_NAME_MAX_LENGTH - (baseHash.length + 1));
  const trimmedBase = baseName.slice(0, maxBaseLength).replace(/_+$/g, "") || "action";

  let candidate = trimmedBase;
  if (candidate.length > TOOL_NAME_MAX_LENGTH) {
    candidate = candidate.slice(0, TOOL_NAME_MAX_LENGTH);
  }

  const existingActionId = usedNames.get(candidate);
  if (existingActionId && existingActionId !== actionId) {
    candidate = `${trimmedBase}_${baseHash}`.slice(0, TOOL_NAME_MAX_LENGTH);
  }

  let collisionCounter = 1;
  while (usedNames.has(candidate) && usedNames.get(candidate) !== actionId) {
    const suffix = `_${collisionCounter}`;
    const truncated = trimmedBase.slice(0, Math.max(8, TOOL_NAME_MAX_LENGTH - suffix.length));
    candidate = `${truncated}${suffix}`.slice(0, TOOL_NAME_MAX_LENGTH);
    collisionCounter += 1;
  }

  usedNames.set(candidate, actionId);
  return candidate;
}

function normalizeSurfaceId(value, request) {
  const explicitSurface = normalizeLowerText(value);
  if (explicitSurface) {
    return explicitSurface;
  }

  const requestSurface = normalizeLowerText(request?.surface || request?.headers?.["x-surface-id"]);
  return requestSurface || "app";
}

function isActionAllowedByConfig(actionId, actionsConfig = {}) {
  if (actionsConfig?.enabled === false) {
    return false;
  }

  const normalizedActionId = normalizeLowerText(actionId);
  const blockedIds = toLowerSet(actionsConfig?.blockedActionIds);
  if (blockedIds.has(normalizedActionId)) {
    return false;
  }

  const exposedIds = toLowerSet(actionsConfig?.exposedActionIds);
  if (exposedIds.size > 0 && !exposedIds.has(normalizedActionId)) {
    return false;
  }

  return true;
}

function selectLatestActionDefinitions(definitions = []) {
  const byActionId = new Map();

  for (const entry of definitions) {
    const definition = entry && typeof entry === "object" ? entry : null;
    const actionId = normalizeText(definition?.id);
    const version = Number(definition?.version);
    if (!actionId || !Number.isInteger(version) || version < 1) {
      continue;
    }

    const existing = byActionId.get(actionId);
    if (!existing || Number(existing.version) < version) {
      byActionId.set(actionId, definition);
    }
  }

  return [...byActionId.values()].sort((left, right) => {
    const idCompare = String(left.id || "").localeCompare(String(right.id || ""));
    if (idCompare !== 0) {
      return idCompare;
    }
    return Number(right.version || 0) - Number(left.version || 0);
  });
}

function normalizeToolDefinitions(definitions, { surfaceId, actionsConfig }) {
  return selectLatestActionDefinitions(definitions).filter((definition) => {
    const channels = Array.isArray(definition?.channels) ? definition.channels : [];
    if (!channels.includes(ASSISTANT_TOOL_CHANNEL)) {
      return false;
    }

    const surfaces = Array.isArray(definition?.surfaces) ? definition.surfaces : [];
    if (!surfaces.includes(surfaceId)) {
      return false;
    }

    if (normalizeLowerText(definition?.kind) === "stream") {
      return false;
    }

    if (normalizeLowerText(definition?.visibility) === "operator") {
      return false;
    }

    return isActionAllowedByConfig(definition?.id, actionsConfig);
  });
}

function createToolDescription(definition) {
  const assistantTool = isPlainObject(definition?.assistantTool) ? definition.assistantTool : null;
  const explicitDescription = normalizeText(assistantTool?.description);
  if (explicitDescription) {
    return explicitDescription;
  }

  const actionId = normalizeText(definition?.id);
  if (!actionId) {
    return "Execute an assistant action.";
  }

  return `Execute action ${actionId}.`;
}

function resolveToolInputJsonSchema(definition) {
  const assistantTool = isPlainObject(definition?.assistantTool) ? definition.assistantTool : null;
  if (isPlainObject(assistantTool?.inputJsonSchema)) {
    return assistantTool.inputJsonSchema;
  }

  const inputSchema = definition?.inputSchema;
  if (isPlainObject(inputSchema) && typeof inputSchema.type === "string") {
    return inputSchema;
  }

  return DEFAULT_INPUT_JSON_SCHEMA;
}

function buildAssistantToolIdempotencyKey({ assistantMeta, actionId, args }) {
  const toolCallId = normalizeText(assistantMeta?.toolCallId);
  if (!toolCallId) {
    return "";
  }

  const conversationId = normalizeText(assistantMeta?.conversationId) || "na";
  const actionArgsHash = createHashSuffix(stableStringify(normalizeObject(args)), 16);
  const actionHash = createHashSuffix(actionId, 12);

  return `assist:${conversationId}:${toolCallId}:${actionHash}:${actionArgsHash}`;
}

function mapActionErrorToToolError(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  const code = normalizeLowerText(error?.code);

  if (status === 400 || code === "action_validation_failed" || code === "action_id_required") {
    throw new AppError(400, "Tool arguments were invalid.", {
      code: "AI_TOOL_ARGUMENTS_INVALID",
      details: error?.details
    });
  }

  if (status === 403) {
    throw new AppError(403, "Tool execution is forbidden.", {
      code: "AI_TOOL_FORBIDDEN",
      details: error?.details
    });
  }

  if (status === 404 || code === "action_not_found") {
    throw new AppError(400, "Unknown AI tool.", {
      code: "AI_TOOL_UNKNOWN"
    });
  }

  throw error;
}

function createAssistantActionToolsResolver({
  resolveActionExecutor,
  actionsConfig = {}
} = {}) {
  const resolveExecutor = typeof resolveActionExecutor === "function" ? resolveActionExecutor : () => null;

  return async function resolveToolsForSurface({ surfaceId, request } = {}) {
    const actionExecutor = resolveExecutor();
    if (!actionExecutor || typeof actionExecutor.listDefinitions !== "function" || typeof actionExecutor.execute !== "function") {
      return {
        toolRegistry: {},
        providerTools: [],
        allowedToolNames: []
      };
    }

    const normalizedSurfaceId = normalizeSurfaceId(surfaceId, request);
    const definitions = normalizeToolDefinitions(actionExecutor.listDefinitions(), {
      surfaceId: normalizedSurfaceId,
      actionsConfig
    });

    const usedToolNames = new Map();
    const tools = definitions.map((definition) => {
      const actionId = normalizeText(definition.id);
      const actionVersion = Number(definition.version) || 1;
      const toolName = createToolName(actionId, usedToolNames);

      return {
        name: toolName,
        description: createToolDescription(definition),
        inputJsonSchema: resolveToolInputJsonSchema(definition),
        requiredPermissions: [],
        async execute({ args, context }) {
          const requestObject = context?.request || request || null;
          const normalizedArgs = normalizeObject(args);
          const assistantMeta = normalizeObject(context?.assistantMeta);
          const actorPermissions = Array.isArray(context?.permissions)
            ? context.permissions
            : Array.isArray(requestObject?.permissions)
              ? requestObject.permissions
              : [];
          const idempotencyKey = buildAssistantToolIdempotencyKey({
            assistantMeta,
            actionId,
            args: normalizedArgs
          });

          try {
            return await actionExecutor.execute({
              actionId,
              version: actionVersion,
              input: normalizedArgs,
              context: {
                request: requestObject,
                actor: context?.user || requestObject?.user || null,
                workspace: context?.workspace || requestObject?.workspace || null,
                permissions: actorPermissions,
                channel: ASSISTANT_TOOL_CHANNEL,
                surface: normalizedSurfaceId,
                assistantMeta: {
                  ...assistantMeta,
                  toolName,
                  actionId
                },
                requestMeta: {
                  idempotencyKey
                }
              }
            });
          } catch (error) {
            mapActionErrorToToolError(error);
          }
        }
      };
    });

    const toolRegistry = buildAiToolRegistry({
      tools
    });

    return {
      toolRegistry,
      providerTools: listToolSchemas(toolRegistry),
      allowedToolNames: Object.keys(toolRegistry)
    };
  };
}

const __testables = {
  normalizeText,
  normalizeLowerText,
  toLowerSet,
  normalizeObject,
  stableStringify,
  createHashSuffix,
  createBaseToolName,
  createToolName,
  normalizeSurfaceId,
  isActionAllowedByConfig,
  selectLatestActionDefinitions,
  normalizeToolDefinitions,
  createToolDescription,
  resolveToolInputJsonSchema,
  buildAssistantToolIdempotencyKey
};

export { createAssistantActionToolsResolver, __testables };
