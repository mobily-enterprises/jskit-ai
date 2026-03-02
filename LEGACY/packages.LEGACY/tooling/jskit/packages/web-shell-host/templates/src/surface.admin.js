import AdminShell from "./layout.admin.vue";
import { createShellRouter } from "./runtime/router.js";
import { createWebShellApp } from "./runtime/createWebShellApp.js";
import { listFilesystemRouteEntries } from "./runtime/filesystemHost.admin.js";
import { initializeOptionalAuthGuardRuntime, listOptionalPublicAuthRoutes } from "./runtime/optionalAuth.js";

async function boot() {
  await initializeOptionalAuthGuardRuntime({
    loginRoute: "/login"
  });

  const publicRoutes = await listOptionalPublicAuthRoutes();
  const router = createShellRouter({
    shellComponent: AdminShell,
    listFilesystemRouteEntries,
    redirectFromRootTo: "/admin",
    publicRoutes
  });

  createWebShellApp({ router });
}

void boot();
