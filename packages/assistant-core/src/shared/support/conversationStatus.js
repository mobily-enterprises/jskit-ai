import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const ASSISTANT_CONVERSATION_STATUSES = Object.freeze(["active", "completed", "failed", "aborted"]);
const ASSISTANT_CONVERSATION_STATUS_SET = new Set(ASSISTANT_CONVERSATION_STATUSES);

function normalizeConversationStatus(value, { fallback = "" } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (ASSISTANT_CONVERSATION_STATUS_SET.has(normalized)) {
    return normalized;
  }

  return normalizeText(fallback).toLowerCase();
}

export {
  ASSISTANT_CONVERSATION_STATUSES,
  normalizeConversationStatus
};
