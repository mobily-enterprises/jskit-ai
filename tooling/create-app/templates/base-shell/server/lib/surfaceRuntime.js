import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { SURFACE_DEFAULT_ID, SURFACE_DEFINITIONS, SURFACE_MODE_ALL } from "../../config/surfaces.js";

const surfaceRuntime = createSurfaceRuntime({
  allMode: SURFACE_MODE_ALL,
  surfaces: SURFACE_DEFINITIONS,
  defaultSurfaceId: SURFACE_DEFAULT_ID
});

export { surfaceRuntime };
