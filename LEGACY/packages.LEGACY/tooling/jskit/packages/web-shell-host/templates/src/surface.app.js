import AppShell from "./layout.app.vue";
import { createShellRouter } from "./runtime/router.js";
import { createWebShellApp } from "./runtime/createWebShellApp.js";
import { listFilesystemRouteEntries } from "./runtime/filesystemHost.app.js";
import { initializeOptionalAuthGuardRuntime, listOptionalPublicAuthRoutes } from "./runtime/optionalAuth.js";

async function boot() {
  await initializeOptionalAuthGuardRuntime({
    loginRoute: "/login"
  });

  const publicRoutes = await listOptionalPublicAuthRoutes();
  const router = createShellRouter({
    shellComponent: AppShell,
    listFilesystemRouteEntries,
    redirectFromRootTo: "/app",
    publicRoutes
  });

  createWebShellApp({ router });
}

void boot();
