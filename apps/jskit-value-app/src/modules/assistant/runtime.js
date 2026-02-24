import { createAssistantRuntime } from "@jskit-ai/assistant-client-runtime";
import { resolveSurfaceFromPathname } from "../../../shared/surfacePaths.js";
import { api } from "../../platform/http/api/index.js";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";

const assistantRuntime = createAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname
});

const { useAssistantRuntime, useAssistantView, assistantRuntimeTestables } = assistantRuntime;

export { useAssistantRuntime, useAssistantView, assistantRuntimeTestables };
