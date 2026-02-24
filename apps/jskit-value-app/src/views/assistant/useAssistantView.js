import { assistantRuntimeTestables } from "../../runtime/assistantRuntime.js";

// Legacy test seam: keep this view-level export stable while runtime wiring lives in composition root.
export { useAssistantView } from "../../runtime/assistantRuntime.js";
export const __testables = assistantRuntimeTestables;
