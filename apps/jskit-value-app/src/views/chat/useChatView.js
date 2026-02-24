import { configureChatRuntime, useChatRuntime } from "@jskit-ai/chat-client-runtime";
import { REALTIME_EVENT_TYPES } from "../../../shared/eventTypes.js";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { api } from "../../services/api/index.js";
import { subscribeRealtimeEvents } from "../../services/realtime/realtimeEventBus.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";

configureChatRuntime({
  api,
  subscribeRealtimeEvents,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore,
  realtimeEventTypes: REALTIME_EVENT_TYPES
});

export const useChatView = useChatRuntime;
