import * as manifest from "./generated/filesystemManifest.console.generated.js";
import { createFilesystemHost } from "./filesystemHost.js";

const { listFilesystemRouteEntries, listShellEntriesBySlot, resolveSurfaceFromPathname } = createFilesystemHost(
  manifest,
  { surface: "console" }
);

export { listFilesystemRouteEntries, listShellEntriesBySlot, resolveSurfaceFromPathname };
