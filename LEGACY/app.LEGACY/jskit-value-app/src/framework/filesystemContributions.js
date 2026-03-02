import {
  composeFilesystemRoutesFromModules,
  composeShellEntriesBySlotFromModules
} from "@jskit-ai/web-runtime-core/filesystemComposition";
import { createRoutes as createFilesystemRoutes } from "../app/router/routes/filesystemRoutes.js";

const ROUTE_MODULES = import.meta.glob("../pages/**/*.{vue,mjs,cjs,js,ts,tsx,jsx}");
const SHELL_ENTRY_MODULES = import.meta.glob("../surfaces/**/*.entry.{mjs,cjs,js,ts}", { eager: true });

function normalizeSurface(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toOrder(value, fallback = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listFilesystemRouteEntries(surface) {
  const normalizedSurface = normalizeSurface(surface);
  if (!normalizedSurface) {
    return [];
  }

  return composeFilesystemRoutesFromModules({
    modules: ROUTE_MODULES,
    surface: normalizedSurface,
    directoryName: "pages"
  });
}

function buildFilesystemRouteFragment(surface) {
  const normalizedSurface = normalizeSurface(surface);
  const filesystemRouteEntries = listFilesystemRouteEntries(normalizedSurface);
  if (filesystemRouteEntries.length < 1) {
    return null;
  }

  return Object.freeze({
    id: `filesystem.${normalizedSurface}`,
    order: 900,
    createRoutes: createFilesystemRoutes,
    options: Object.freeze({
      filesystemSurface: normalizedSurface,
      filesystemRouteEntries
    })
  });
}

function listFilesystemShellEntriesBySlot(surface) {
  const normalizedSurface = normalizeSurface(surface);
  if (!normalizedSurface) {
    return Object.freeze({
      drawer: Object.freeze([]),
      top: Object.freeze([]),
      config: Object.freeze([])
    });
  }

  return composeShellEntriesBySlotFromModules({
    modules: SHELL_ENTRY_MODULES,
    surface: normalizedSurface,
    directoryName: "surfaces"
  });
}

function listFilesystemNavigationFragments(surface) {
  const shellEntries = listFilesystemShellEntriesBySlot(surface);
  return shellEntries.drawer
    .map((entry) =>
      Object.freeze({
        id: entry.id,
        order: toOrder(entry.order, 900),
        title: entry.title,
        destinationTitle: entry.title,
        path: entry.route,
        icon: entry.icon || "$navChoice2",
        featureFlag: entry.guard?.featureFlag || "",
        requiredFeaturePermissionKey: entry.guard?.requiredFeaturePermissionKey || "",
        requiredAnyPermission: Array.isArray(entry.guard?.requiredAnyPermission)
          ? entry.guard.requiredAnyPermission
          : []
      })
    )
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export {
  listFilesystemRouteEntries,
  buildFilesystemRouteFragment,
  listFilesystemShellEntriesBySlot,
  listFilesystemNavigationFragments
};
