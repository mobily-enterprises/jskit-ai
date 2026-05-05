import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const ASSISTANT_SETTINGS_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  responseType: "assistant-settings",
  responseKind: "record"
});

const ASSISTANT_SETTINGS_UPDATE_TRANSPORT = deepFreeze({
  ...ASSISTANT_SETTINGS_TRANSPORT,
  requestType: "assistant-settings"
});

const ASSISTANT_CONVERSATIONS_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  responseType: "assistant-conversations",
  responseKind: "collection"
});

const ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  responseType: "assistant-conversation-messages",
  responseKind: "record"
});

export {
  ASSISTANT_SETTINGS_TRANSPORT,
  ASSISTANT_SETTINGS_UPDATE_TRANSPORT,
  ASSISTANT_CONVERSATIONS_TRANSPORT,
  ASSISTANT_CONVERSATION_MESSAGES_TRANSPORT
};
