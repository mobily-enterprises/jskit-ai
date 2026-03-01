import AdminShell from "./layout.admin.vue";
import { createShellRouter } from "./runtime/router.js";
import { createWebShellApp } from "./runtime/createWebShellApp.js";
import { listFilesystemRouteEntries } from "./runtime/filesystemHost.admin.js";

const router = createShellRouter({
  shellComponent: AdminShell,
  listFilesystemRouteEntries,
  redirectFromRootTo: "/admin"
});

createWebShellApp({ router });
