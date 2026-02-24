import { createChatRuntime } from "@jskit-ai/chat-client-runtime";
import { REALTIME_EVENT_TYPES } from "../shared/eventTypes.js";
import { useAuthGuard } from "../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core";
import { api } from "../services/api/index.js";
import { subscribeRealtimeEvents } from "../services/realtime/realtimeEventBus.js";
import { useWorkspaceStore } from "../stores/workspaceStore.js";

const chatRuntime = createChatRuntime({
  api,
  subscribeRealtimeEvents,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore,
  realtimeEventTypes: REALTIME_EVENT_TYPES
});

const { useChatRuntime, useChatView, chatRuntimeTestables } = chatRuntime;

export { useChatRuntime, useChatView, chatRuntimeTestables };
