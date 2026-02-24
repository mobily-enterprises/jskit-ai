import {
  configureAssistantRuntime,
  useAssistantRuntime,
  assistantRuntimeTestables
} from "@jskit-ai/assistant-client-runtime";
import { resolveSurfaceFromPathname } from "../../../shared/surfacePaths.js";
import { api } from "../../services/api/index.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";

configureAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname
});

export const useAssistantView = useAssistantRuntime;
export const __testables = assistantRuntimeTestables;
