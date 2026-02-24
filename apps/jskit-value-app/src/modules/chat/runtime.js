import { createChatRuntime } from "@jskit-ai/chat-client-runtime";
import { REALTIME_EVENT_TYPES } from "../../../shared/eventTypes.js";
import { chatConfig } from "../../../config/chat.js";
import { useAuthGuard } from "../auth/useAuthGuard.js";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core";
import { api } from "../../platform/http/api/index.js";
import { subscribeRealtimeEvents } from "../../platform/realtime/realtimeEventBus.js";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";

const chatRuntime = createChatRuntime({
  api,
  subscribeRealtimeEvents,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore,
  realtimeEventTypes: REALTIME_EVENT_TYPES,
  policy: {
    messageMaxChars: chatConfig.messageMaxTextChars,
    attachmentMaxFilesPerMessage: chatConfig.attachmentsMaxFilesPerMessage,
    attachmentMaxUploadBytes: chatConfig.attachmentMaxUploadBytes
  }
});

const { useChatRuntime, useChatView, chatRuntimeTestables } = chatRuntime;

export { useChatRuntime, useChatView, chatRuntimeTestables };
