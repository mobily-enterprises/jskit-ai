import { normalizeLowerText, normalizeText } from "./textNormalization.js";

function normalizePermissions(value) {
  const source = Array.isArray(value) ? value : [];
  return Array.from(new Set(source.map((entry) => normalizeText(entry)).filter(Boolean)));
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== "object") {
    return null;
  }

  return {
    id: actor.id == null ? null : actor.id,
    email: normalizeLowerText(actor.email),
    roleId: normalizeLowerText(actor.roleId),
    isOperator: actor.isOperator === true
  };
}

function normalizeWorkspace(workspace) {
  if (!workspace || typeof workspace !== "object") {
    return null;
  }

  return {
    id: workspace.id == null ? null : workspace.id,
    slug: normalizeText(workspace.slug),
    name: normalizeText(workspace.name)
  };
}

function normalizeMembership(membership) {
  if (!membership || typeof membership !== "object") {
    return null;
  }

  return {
    roleId: normalizeLowerText(membership.roleId),
    status: normalizeLowerText(membership.status)
  };
}

function normalizeRequestMeta(requestMeta) {
  const source = requestMeta && typeof requestMeta === "object" ? requestMeta : {};

  return {
    requestId: normalizeText(source.requestId),
    commandId: normalizeText(source.commandId),
    idempotencyKey: normalizeText(source.idempotencyKey),
    ip: normalizeText(source.ip),
    userAgent: normalizeText(source.userAgent),
    request: source.request || null
  };
}

function normalizeAssistantMeta(assistantMeta) {
  const source = assistantMeta && typeof assistantMeta === "object" ? assistantMeta : {};

  return {
    conversationId: normalizeText(source.conversationId),
    toolCallId: normalizeText(source.toolCallId),
    provider: normalizeText(source.provider),
    turnId: normalizeText(source.turnId)
  };
}

function normalizeTimeMeta(timeMeta) {
  const source = timeMeta && typeof timeMeta === "object" ? timeMeta : {};
  const nowValue = source.now instanceof Date ? source.now : new Date();

  return {
    now: nowValue,
    timezone: normalizeText(source.timezone),
    locale: normalizeText(source.locale)
  };
}

function normalizeExecutionContext(context = {}) {
  const source = context && typeof context === "object" ? context : {};

  return Object.freeze({
    actor: normalizeActor(source.actor),
    workspace: normalizeWorkspace(source.workspace),
    membership: normalizeMembership(source.membership),
    permissions: normalizePermissions(source.permissions),
    surface: normalizeLowerText(source.surface) || "app",
    channel: normalizeLowerText(source.channel) || "internal",
    requestMeta: normalizeRequestMeta(source.requestMeta),
    assistantMeta: normalizeAssistantMeta(source.assistantMeta),
    timeMeta: normalizeTimeMeta(source.timeMeta)
  });
}

const __testables = {
  normalizeText,
  normalizeLowerText,
  normalizePermissions,
  normalizeActor,
  normalizeWorkspace,
  normalizeMembership,
  normalizeRequestMeta,
  normalizeAssistantMeta,
  normalizeTimeMeta
};

export { normalizeExecutionContext, __testables };
