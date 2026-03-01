import * as manifest from "./generated/filesystemManifest.app.generated.js";
import { createFilesystemHost } from "./filesystemHost.js";

const { listFilesystemRouteEntries, listShellEntriesBySlot, resolveSurfaceFromPathname } = createFilesystemHost(
  manifest,
  { surface: "app" }
);

export { listFilesystemRouteEntries, listShellEntriesBySlot, resolveSurfaceFromPathname };
