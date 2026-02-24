import { createAssistantRuntime } from "@jskit-ai/assistant-client-runtime";
import { resolveSurfaceFromPathname } from "../../shared/surfacePaths.js";
import { api } from "../services/api/index.js";
import { useWorkspaceStore } from "../stores/workspaceStore.js";

const assistantRuntime = createAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname
});

const { useAssistantRuntime, useAssistantView, assistantRuntimeTestables } = assistantRuntime;

export { useAssistantRuntime, useAssistantView, assistantRuntimeTestables };
