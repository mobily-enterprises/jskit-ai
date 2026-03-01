import AppShell from "./layout.app.vue";
import { createShellRouter } from "./runtime/router.js";
import { createWebShellApp } from "./runtime/createWebShellApp.js";
import { listFilesystemRouteEntries } from "./runtime/filesystemHost.app.js";

const router = createShellRouter({
  shellComponent: AppShell,
  listFilesystemRouteEntries,
  redirectFromRootTo: "/app"
});

createWebShellApp({ router });
