import { createAssistantRuntime } from "@jskit-ai/assistant-client-runtime";
import { aiConfig } from "../../../config/ai.js";
import { resolveSurfaceFromPathname } from "../../../shared/surfacePaths.js";
import { api } from "../../platform/http/api/index.js";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";

const assistantRuntime = createAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname,
  policy: {
    streamTimeoutMs: aiConfig.streamTimeoutMs,
    historyPageSize: aiConfig.historyPageSize,
    restoreMessagesPageSize: aiConfig.restoreMessagesPageSize
  }
});

const { useAssistantRuntime, useAssistantView, assistantRuntimeTestables } = assistantRuntime;

export { useAssistantRuntime, useAssistantView, assistantRuntimeTestables };
