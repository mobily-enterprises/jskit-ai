import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRouteFilePath,
  composeFilesystemRoutesFromModules,
  parseShellEntryFilePath,
  composeShellEntriesFromModules,
  composeShellEntriesBySlotFromModules
} from "./filesystemComposition.js";

test("parseRouteFilePath resolves surface and path from filesystem route file", () => {
  const parsed = parseRouteFilePath("./src/pages/admin/users/$userId.vue");
  assert.deepEqual(parsed, {
    filePath: "./src/pages/admin/users/$userId.vue",
    surface: "admin",
    routePath: "/users/$userId"
  });
});

test("parseRouteFilePath collapses index route to parent path", () => {
  const parsed = parseRouteFilePath("./src/pages/console/errors/index.js");
  assert.deepEqual(parsed, {
    filePath: "./src/pages/console/errors/index.js",
    surface: "console",
    routePath: "/errors"
  });
});

test("composeFilesystemRoutesFromModules returns sorted route definitions", () => {
  const routes = composeFilesystemRoutesFromModules({
    surface: "admin",
    modules: {
      "./src/pages/admin/billing/index.vue": {
        routeMeta: {
          id: "admin-billing"
        }
      },
      "./src/pages/admin/users/$userId.vue": {}
    }
  });

  assert.equal(routes.length, 2);
  assert.equal(routes[0].routePath, "/billing");
  assert.equal(routes[0].id, "admin-billing");
  assert.equal(routes[1].routePath, "/users/$userId");
  assert.equal(typeof routes[0].loadModule, "function");
});

test("composeFilesystemRoutesFromModules rejects duplicate route path claims", () => {
  assert.throws(
    () =>
      composeFilesystemRoutesFromModules({
        modules: {
          "./src/pages/app/chat/index.vue": {},
          "./src/pages/app/chat.js": {}
        }
      }),
    /Duplicate route path/
  );
});

test("parseShellEntryFilePath resolves surface/slot/id", () => {
  const parsed = parseShellEntryFilePath("./src/surfaces/admin/drawer/server-errors.entry.js");
  assert.deepEqual(parsed, {
    filePath: "./src/surfaces/admin/drawer/server-errors.entry.js",
    surface: "admin",
    slot: "drawer",
    fallbackId: "server-errors"
  });
});

test("composeShellEntriesFromModules normalizes and sorts slot entries", () => {
  const entries = composeShellEntriesFromModules({
    surface: "admin",
    slot: "drawer",
    modules: {
      "./src/surfaces/admin/drawer/settings.entry.js": {
        default: {
          title: "Settings",
          route: "/settings",
          order: 20
        }
      },
      "./src/surfaces/admin/drawer/errors.entry.js": {
        default: {
          id: "errors",
          title: "Errors",
          route: "/errors/server",
          order: 10,
          guard: {
            requiredAnyPermission: ["console.errors.server.read", ""]
          }
        }
      },
      "./src/surfaces/admin/top/account.entry.js": {
        default: {
          title: "Ignored top entry",
          route: "/account"
        }
      }
    }
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "errors");
  assert.equal(entries[1].id, "settings");
  assert.deepEqual(entries[0].guard.requiredAnyPermission, ["console.errors.server.read"]);
});

test("composeShellEntriesFromModules rejects duplicate ids", () => {
  assert.throws(
    () =>
      composeShellEntriesFromModules({
        surface: "console",
        slot: "drawer",
        modules: {
          "./src/surfaces/console/drawer/first.entry.js": {
            default: {
              id: "errors",
              title: "Errors",
              route: "/errors/server"
            }
          },
          "./src/surfaces/console/drawer/second.entry.js": {
            default: {
              id: "errors",
              title: "Errors second",
              route: "/errors/browser"
            }
          }
        }
      }),
    /Duplicate shell entry id/
  );
});

test("composeShellEntriesFromModules rejects lazy slot modules", () => {
  assert.throws(
    () =>
      composeShellEntriesFromModules({
        surface: "app",
        slot: "drawer",
        modules: {
          "./src/surfaces/app/drawer/home.entry.js": async () => ({
            default: {
              title: "Home",
              route: "/"
            }
          })
        }
      }),
    /must be eagerly loaded/
  );
});

test("composeShellEntriesBySlotFromModules returns all slot buckets", () => {
  const bySlot = composeShellEntriesBySlotFromModules({
    surface: "admin",
    modules: {
      "./src/surfaces/admin/drawer/projects.entry.js": {
        default: {
          title: "Projects",
          route: "/projects"
        }
      },
      "./src/surfaces/admin/top/settings.entry.js": {
        default: {
          title: "Settings",
          route: "/settings"
        }
      }
    }
  });

  assert.equal(bySlot.drawer.length, 1);
  assert.equal(bySlot.top.length, 1);
  assert.equal(bySlot.config.length, 0);
});
