import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { config } from "../../config/public.js";

const surfaceRuntime = createSurfaceRuntime({
  tenancyMode: config.tenancyMode,
  allMode: config.surfaceModeAll,
  surfaces: config.surfaceDefinitions,
  defaultSurfaceId: config.surfaceDefaultId,
  workspaceSurfacePolicy: config.workspaceSurfacePolicy
});

export { surfaceRuntime };
