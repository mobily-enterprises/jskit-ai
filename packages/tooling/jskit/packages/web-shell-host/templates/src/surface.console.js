import ConsoleShell from "./layout.console.vue";
import { createShellRouter } from "./runtime/router.js";
import { createWebShellApp } from "./runtime/createWebShellApp.js";
import { listFilesystemRouteEntries } from "./runtime/filesystemHost.console.js";

const router = createShellRouter({
  shellComponent: ConsoleShell,
  listFilesystemRouteEntries,
  redirectFromRootTo: "/console"
});

createWebShellApp({ router });
