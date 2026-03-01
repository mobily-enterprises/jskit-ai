import * as manifest from "./generated/filesystemManifest.admin.generated.js";
import { createFilesystemHost } from "./filesystemHost.js";

const { listFilesystemRouteEntries, listShellEntriesBySlot, resolveSurfaceFromPathname } = createFilesystemHost(
  manifest,
  { surface: "admin" }
);

export { listFilesystemRouteEntries, listShellEntriesBySlot, resolveSurfaceFromPathname };
