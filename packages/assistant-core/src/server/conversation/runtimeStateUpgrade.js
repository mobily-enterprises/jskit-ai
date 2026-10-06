const engines = new Set(["api", "claude", "codex", "opencode"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function invalid(message) {
  throw Object.assign(new Error(message), { code: "conversation_runtime_upgrade_unavailable" });
}

export function hasUnfinishedConversationRewind(runtime) {
  const pending = runtime?.replacement;
  return pending?.reason === "rewind" || pending?.request?.reason === "rewind" ||
    object(pending?.request) && Object.hasOwn(pending.request, "throughTurnId") ||
    Array.isArray(pending?.supersededTurns) && pending.supersededTurns.length > 0;
}

function validateSegment(segment) {
  if (!object(segment) || !engines.has(segment.engine) || typeof segment.segmentId !== "string" ||
      !segment.segmentId || !object(segment.configuration) || !object(segment.seen) ||
      Object.values(segment.seen).some(value => typeof value !== "string") ||
      Object.hasOwn(segment, "preparedAt") && typeof segment.preparedAt !== "string") {
    invalid("Conversation runtime has an unsupported segment. Inspect its saved state before upgrading.");
  }
  if (segment.engine !== "api" && !object(segment.binding)) {
    invalid("A native conversation has no saved binding. Restore its exact identity before upgrading.");
  }
  if (segment.engine === "opencode" && segment.binding.sessionId &&
      (typeof segment.binding.databasePath !== "string" || !segment.binding.databasePath)) {
    invalid("This OpenCode conversation uses an older private database binding. A complete offline native-history upgrade is required before this metadata upgrade; its database was not changed.");
  }
}

function nativeIdentity(segment) {
  return segment.engine === "codex" ? segment.binding.threadId
    : segment.engine === "claude" ? segment.binding.conversationId : segment.binding.sessionId;
}

function inspectRequest(request, segment, version, warnings) {
  if (request === undefined) return;
  if (!object(request) || typeof request.messageId !== "string" || !request.messageId ||
      typeof request.text !== "string" || !Array.isArray(request.attachments) ||
      typeof request.at !== "string") {
    invalid("Conversation runtime has an unsupported pending request. Inspect it before upgrading.");
  }
  if (segment.engine === "api") return;
  const threadId = nativeIdentity(segment);
  if (version === 3 && !Object.hasOwn(request, "inspectionOnly")) {
    if (typeof request.attempted !== "boolean" || request.attempted &&
        (typeof threadId !== "string" || !threadId || request.threadId !== threadId || typeof request.message !== "string") ||
        Object.hasOwn(request, "message") && (typeof request.message !== "string" || typeof request.displayMessage !== "string" ||
          !Array.isArray(request.displayAttachments) || !Array.isArray(request.attachmentIds) || !object(request.seen)) ||
        Object.hasOwn(request, "contextText") && (typeof request.contextText !== "string" || !Array.isArray(request.contextAttachments)) ||
        Object.hasOwn(request, "attachmentManifest") && typeof request.attachmentManifest !== "string") {
      invalid("A native delivery journal has an unsupported frozen prompt or identity. Inspect it before upgrading.");
    }
    return;
  }
  if (typeof threadId !== "string" || !threadId) {
    invalid("A pending native request has no exact saved conversation identity. Resolve its delivery with the previous candidate before upgrading; it cannot be replayed safely.");
  }
  if (version === 3) {
    if (request.inspectionOnly !== true || request.threadId !== threadId || Object.hasOwn(request, "message")) {
      invalid("An inspection-only request conflicts with its saved native identity or prompt. Inspect it before upgrading.");
    }
    return;
  }
  if (["message", "displayMessage", "displayAttachments", "attachmentIds", "attempted", "threadId", "turnMetadata", "inspectionOnly",
    "contextText", "contextAttachments", "attachmentManifest"]
    .some(name => Object.hasOwn(request, name))) {
    invalid("A version 2 pending request contains unknown native delivery fields. Inspect it before upgrading.");
  }
  // Version 2 saved authored content and a cursor, but never the rendered prompt.
  // The existing exact binding is enough for receipt inspection, never replay.
  request.inspectionOnly = true;
  request.threadId = threadId;
  warnings.push(`The retained ${segment.engine} request requires native receipt inspection. Its missing prompt was not reconstructed and will not be replayed.`);
}

/** Pure offline transform. The application owns enumeration, backups and publication. */
export function upgradeConversationRuntimeState({ metadata, conversationLog }) {
  if (!object(metadata) || !Array.isArray(conversationLog)) {
    invalid("Conversation runtime upgrade requires metadata and the complete stored transcript.");
  }
  if (metadata.runtime === undefined) return { metadata, changed: false, warnings: [] };
  const source = metadata.runtime;
  if (!object(source) || ![2, 3].includes(source.version) || !Array.isArray(source.predecessors)) {
    invalid("This conversation has an unsupported runtime version. Inspect its original format and provide an offline conversion before opening it.");
  }
  if (hasUnfinishedConversationRewind(source)) {
    invalid("This conversation has an unfinished Undo operation from an earlier runtime. Inspect its saved native and local history offline before upgrading; no history was changed.");
  }
  if (source.version === 3 && (typeof source.lastEngine !== "string" || source.lastEngine && !engines.has(source.lastEngine))) {
    invalid("Conversation runtime has an invalid last-delivered engine. Inspect it before upgrading.");
  }
  const runtime = structuredClone(source);
  const warnings = [];
  for (const segment of [...runtime.predecessors, runtime]) {
    validateSegment(segment);
    inspectRequest(segment.request, segment, source.version, warnings);
  }
  if (runtime.replacement !== undefined) {
    const pending = runtime.replacement;
    if (!object(pending) || !engines.has(pending.engine) || typeof pending.segmentId !== "string" ||
        !pending.segmentId || !object(pending.configuration) ||
        Object.hasOwn(pending, "preparedAt") && typeof pending.preparedAt !== "string") {
      invalid("Conversation runtime has an unsupported unfinished replacement. Finish or inspect it before upgrading.");
    }
    if (pending.binding) {
      validateSegment(pending);
      inspectRequest(pending.submission, pending, source.version, warnings);
    } else if (pending.submission !== undefined) {
      invalid("An unfinished replacement has a request without its exact saved binding. Inspect it before upgrading.");
    }
  }
  if (source.version === 3) return { metadata, changed: false, warnings: [] };
  let lastEngine = "";
  for (const turn of conversationLog) {
    if (!object(turn) || !Array.isArray(turn.messages)) invalid("Conversation history has an unsupported turn. Inspect it before upgrading.");
    const attribution = turn.metadata?.runtime;
    if (!attribution || attribution.supersededBy || !turn.messages.some(message => ["user", "system"].includes(message.role))) continue;
    if (!engines.has(attribution.engine)) invalid("An accepted conversation turn has an unknown engine. Inspect its attribution before upgrading.");
    lastEngine = attribution.engine;
  }
  runtime.version = 3;
  runtime.lastEngine = lastEngine;
  return { metadata: { ...metadata, runtime }, changed: true, warnings };
}
