import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceThemePalette } from "@jskit-ai/workspaces-core/shared/settings";
import { ThemeSymbol } from "vuetify/lib/composables/theme.js";
import { createMemoryHistory, createRouter } from "vue-router";
import { createVuetifyThemeController } from "./support/vuetifyThemeController.js";
import {
  WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN,
  WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND,
  WORKSPACE_BOOTSTRAP_STATUS_RESOLVED,
  WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED,
  createBootstrapPlacementRuntime
} from "../src/client/runtime/bootstrapPlacementRuntime.js";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";

const SHELL_GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";

function flushTasks() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test.afterEach(() => {
  try {
    delete globalThis[SHELL_GUARD_EVALUATOR_KEY];
  } catch {}
});

function createPlacementRuntimeStub() {
  const listeners = new Set();
  const setCalls = [];
  let context = Object.freeze({
    surfaceConfig: {
      tenancyMode: "workspaces",
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app", "admin", "home"],
      surfacesById: {
        home: {
          id: "home",
          enabled: true,
          pagesRoot: "",
          routeBase: "/",
          requiresWorkspace: false
        },
        app: {
          id: "app",
          enabled: true,
          pagesRoot: "w/[workspaceSlug]",
          routeBase: "/w/:workspaceSlug",
          requiresWorkspace: true
        },
        admin: {
          id: "admin",
          enabled: true,
          pagesRoot: "w/[workspaceSlug]/admin",
          routeBase: "/w/:workspaceSlug/admin",
          requiresWorkspace: true
        }
      }
    }
  });

  return {
    getContext() {
      return context;
    },
    setContext(patch = {}, { replace = false, source = "" } = {}) {
      context = Object.freeze(
        replace
          ? {
              ...patch
            }
          : {
              ...context,
              ...patch
            }
      );
      setCalls.push({
        patch,
        source
      });
      for (const listener of listeners) {
        listener({
          type: "context.updated",
          source
        });
      }
      return context;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setCalls
  };
}

function resolvePathFromFullPath(fullPath = "/") {
  const normalizedFullPath = String(fullPath || "").trim() || "/";
  const queryStart = normalizedFullPath.indexOf("?");
  const hashStart = normalizedFullPath.indexOf("#");
  const stopIndex = [queryStart, hashStart]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (typeof stopIndex !== "number") {
    return normalizedFullPath;
  }
  return normalizedFullPath.slice(0, stopIndex) || "/";
}

function createRouterStub(initialPath = "/w/acme/dashboard") {
  const afterEachListeners = [];
  const replaceCalls = [];
  const normalizedInitialPath = String(initialPath || "").trim() || "/";
  const router = {
    currentRoute: {
      value: {
        path: resolvePathFromFullPath(normalizedInitialPath),
        fullPath: normalizedInitialPath
      }
    },
    afterEach(listener) {
      afterEachListeners.push(listener);
      return () => {
        const index = afterEachListeners.indexOf(listener);
        if (index >= 0) {
          afterEachListeners.splice(index, 1);
        }
      };
    },
    replace(target) {
      const fullPath = String(target || "").trim() || "/";
      router.currentRoute.value.path = resolvePathFromFullPath(fullPath);
      router.currentRoute.value.fullPath = fullPath;
      replaceCalls.push(fullPath);
      for (const listener of [...afterEachListeners]) {
        listener();
      }
      return Promise.resolve();
    },
    push(target) {
      return router.replace(target);
    },
    emitAfterEach() {
      for (const listener of [...afterEachListeners]) {
        listener();
      }
    },
    replaceCalls
  };

  return router;
}

function createSocketStub() {
  const listeners = new Map();
  return {
    on(eventName, handler) {
      listeners.set(eventName, handler);
    },
    off(eventName, handler) {
      if (listeners.get(eventName) === handler) {
        listeners.delete(eventName);
      }
    },
    emit(eventName, payload) {
      listeners.get(eventName)?.(payload);
    }
  };
}

function createBootstrapRuntimeStub() {
  const calls = [];
  return {
    async refresh(reason) {
      calls.push(String(reason || ""));
      return null;
    },
    calls
  };
}

function createTestRuntime({
  placementRuntime,
  router,
  bootstrapRuntime = createBootstrapRuntimeStub(),
  socket = null,
  vueApp = createVueAppWithThemeController(undefined)
} = {}) {
  return createBootstrapPlacementRuntime({
    placementRuntime,
    bootstrapRuntime,
    realtime: socket ? { socket } : null,
    router,
    vueApp,
    logger: silentLogger
  });
}

function createVueAppWithThemeController(themeController) {
  return {
    _context: {
      provides: {
        [ThemeSymbol]: themeController
      }
    }
  };
}

function createBootstrapRequest(path = "/w/acme/dashboard", workspaceSlug = "") {
  const normalizedPath = resolvePathFromFullPath(path);
  const normalizedWorkspaceSlug = String(workspaceSlug || "").trim().toLowerCase();
  return Object.freeze({
    path: "/api/bootstrap",
    query: Object.freeze(normalizedWorkspaceSlug ? { workspaceSlug: normalizedWorkspaceSlug } : {}),
    meta: Object.freeze({
      path: normalizedPath,
      workspaceSlug: normalizedWorkspaceSlug
    })
  });
}

function createErrorWithStatus(status, message = "") {
  const error = new Error(message || `HTTP ${status}`);
  error.status = status;
  return error;
}

test("bootstrap placement runtime contributes workspace slug to shared bootstrap request and writes payload into placement context", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/dashboard");
  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  const request = runtime.resolveBootstrapRequest();
  assert.deepEqual(request, {
    query: {
      workspaceSlug: "acme"
    },
    meta: {
      workspaceSlug: "acme"
    }
  });

  await runtime.applyBootstrapPayload({
    request,
    payload: {
      session: {
        authenticated: true,
        userId: "7"
      },
      profile: {
        displayName: "Ada Lovelace",
        email: "ADA@EXAMPLE.COM",
        avatar: {
          effectiveUrl: "https://cdn.example.com/ada.png"
        }
      },
      app: {
        features: {
          workspaceInvites: true
        }
      },
      pendingInvites: [
        { id: "1", workspaceId: "1", token: "a" },
        { id: "2", workspaceId: "2", token: "b" }
      ],
      workspaces: [{ id: "1", slug: "acme", name: "Acme Workspace" }],
      permissions: ["workspace.settings.view"]
    },
    source: "test.bootstrap"
  });

  const context = placementRuntime.getContext();
  assert.equal(context.workspace?.slug, "acme");
  assert.equal(Array.isArray(context.workspaces), true);
  assert.equal(context.workspaces.length, 1);
  assert.deepEqual(context.permissions, ["workspace.settings.view"]);
  assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), WORKSPACE_BOOTSTRAP_STATUS_RESOLVED);
  assert.equal(context.workspaceBootstrapStatuses?.acme, WORKSPACE_BOOTSTRAP_STATUS_RESOLVED);
  assert.equal(context.workspaceInvitesEnabled, true);
  assert.equal(context.pendingInvitesCount, 2);
});

test("bootstrap placement runtime remembers the last workspace each user opened in this browser", async (context) => {
  const stored = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value))
    }
  };
  context.after(() => {
    delete globalThis.window;
  });
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme");
  const runtime = createTestRuntime({ placementRuntime, router });
  const session = { authenticated: true, userId: "7" };
  const workspaces = [{ id: "1", slug: "acme", name: "Acme Workspace" }];

  await runtime.initialize();
  await runtime.applyBootstrapPayload({
    request: createBootstrapRequest("/w/acme", "acme"),
    payload: { session, workspaces, requestedWorkspace: { slug: "acme", status: "resolved" }, permissions: [] }
  });
  await router.push("/w/missing");
  await runtime.applyBootstrapPayload({
    request: createBootstrapRequest("/w/missing", "missing"),
    payload: { session, workspaces, requestedWorkspace: { slug: "missing", status: "not_found" }, permissions: [] }
  });

  assert.equal(stored.get("jskit.workspaces-web.last-workspace.7"), "acme");
});

test("bootstrap placement runtime resolves workspace slug from pathname when surface config is missing", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  placementRuntime.setContext({}, { replace: true, source: "test.clear" });
  const router = createRouterStub("/w/acme/admin");
  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  const request = runtime.resolveBootstrapRequest();
  assert.deepEqual(request.query, {
    workspaceSlug: "acme"
  });

  await runtime.applyBootstrapPayload({
    request,
    payload: {
      session: {
        authenticated: true,
        userId: "1"
      },
      profile: {
        displayName: "User",
        email: "user@example.com",
        avatar: {
          effectiveUrl: ""
        }
      },
      workspaces: [{ id: "1", slug: "acme", name: "Acme Workspace" }],
      permissions: ["workspace.settings.view"]
    }
  });

  assert.deepEqual(placementRuntime.getContext().permissions, ["workspace.settings.view"]);
});

test("bootstrap placement runtime does not mutate placement auth context", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  placementRuntime.setContext(
    {
      auth: {
        authenticated: true,
        oauthDefaultProvider: "github",
        oauthProviders: [{ id: "github", label: "GitHub" }]
      }
    },
    { source: "test.seed" }
  );
  const router = createRouterStub("/w/acme/dashboard");
  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  await runtime.applyBootstrapPayload({
    request: createBootstrapRequest("/w/acme/dashboard", "acme"),
    payload: {
      session: {
        authenticated: true,
        userId: "9"
      },
      profile: {
        displayName: "User",
        email: "user@example.com",
        avatar: {
          effectiveUrl: ""
        }
      },
      workspaces: [{ id: "1", slug: "acme", name: "Workspace" }],
      permissions: []
    }
  });

  assert.deepEqual(placementRuntime.getContext().auth, {
    authenticated: true,
    oauthDefaultProvider: "github",
    oauthProviders: [{ id: "github", label: "GitHub" }]
  });
});

test("bootstrap placement runtime delegates route and realtime refreshes to the shared bootstrap runtime", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/dashboard");
  const socket = createSocketStub();
  const bootstrapRuntime = createBootstrapRuntimeStub();
  const runtime = createTestRuntime({ placementRuntime, bootstrapRuntime, router, socket });

  await runtime.initialize();
  assert.deepEqual(bootstrapRuntime.calls, []);

  router.currentRoute.value.path = "/w/acme/customers";
  router.currentRoute.value.fullPath = "/w/acme/customers";
  router.emitAfterEach();
  await flushTasks();
  assert.deepEqual(bootstrapRuntime.calls, []);

  router.currentRoute.value.path = "/w/zen/dashboard";
  router.currentRoute.value.fullPath = "/w/zen/dashboard";
  router.emitAfterEach();
  await flushTasks();
  assert.deepEqual(bootstrapRuntime.calls, ["route"]);

  socket.emit("users.bootstrap.changed", {});
  await flushTasks();
  assert.deepEqual(bootstrapRuntime.calls, ["route", "realtime"]);
});

test("bootstrap placement runtime applies theme changes from bootstrap payloads", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/dashboard");
  const themeController = createVuetifyThemeController("light");
  const runtime = createTestRuntime({
    placementRuntime,
    router,
    vueApp: createVueAppWithThemeController(themeController)
  });

  await runtime.initialize();
  const request = createBootstrapRequest("/w/acme/dashboard", "acme");
  await runtime.applyBootstrapPayload({
    request,
    payload: {
      session: {
        authenticated: true,
        userId: "1"
      },
      userSettings: {
        theme: "dark"
      },
      workspaces: [{ id: "1", slug: "acme", name: "Workspace" }],
      permissions: []
    }
  });
  assert.equal(themeController.global.name.value, "workspace-dark");

  await runtime.applyBootstrapPayload({
    request,
    payload: {
      session: {
        authenticated: true,
        userId: "1"
      },
      userSettings: {
        theme: "light"
      },
      workspaces: [{ id: "1", slug: "acme", name: "Workspace" }],
      permissions: []
    }
  });
  assert.equal(themeController.global.name.value, "workspace-light");
});

test("bootstrap placement runtime applies workspace palette and clears it when leaving workspace routes", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/dashboard");
  const themeController = createVuetifyThemeController("light");
  const runtime = createTestRuntime({
    placementRuntime,
    router,
    vueApp: createVueAppWithThemeController(themeController)
  });

  await runtime.initialize();
  await runtime.applyBootstrapPayload({
    request: createBootstrapRequest("/w/acme/dashboard", "acme"),
    payload: {
      session: {
        authenticated: true,
        userId: "1"
      },
      workspaceSettings: {
        lightPrimaryColor: "#CC3344",
        lightSecondaryColor: "#884455",
        lightSurfaceColor: "#F4F4F4",
        lightSurfaceVariantColor: "#444444",
        darkPrimaryColor: "#BB2233",
        darkSecondaryColor: "#557799",
        darkSurfaceColor: "#202020",
        darkSurfaceVariantColor: "#A0A0A0"
      },
      workspaces: [
        {
          id: "1",
          slug: "acme",
          name: "Acme Workspace"
        }
      ],
      permissions: []
    }
  });

  const palette = resolveWorkspaceThemePalette({
    lightPrimaryColor: "#CC3344",
    lightSecondaryColor: "#884455",
    lightSurfaceColor: "#F4F4F4",
    lightSurfaceVariantColor: "#444444"
  }, {
    mode: "light"
  });
  assert.equal(themeController.global.name.value, "workspace-light");
  assert.equal(themeController.themes.value["workspace-light"].colors.primary, palette.color);
  assert.equal(themeController.themes.value["workspace-light"].colors.secondary, palette.secondaryColor);
  assert.equal(themeController.themes.value["workspace-light"].colors.surface, palette.surfaceColor);
  assert.equal(
    themeController.themes.value["workspace-light"].colors["surface-variant"],
    palette.surfaceVariantColor
  );

  router.currentRoute.value.path = "/home";
  router.currentRoute.value.fullPath = "/home";
  router.emitAfterEach();
  await flushTasks();

  assert.equal(themeController.global.name.value, "light");
});

test("bootstrap placement runtime marks workspace slug as not_found and clears workspace context on 404", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  placementRuntime.setContext(
    {
      workspace: { id: "1", slug: "acme", name: "Acme Workspace" },
      workspaces: [{ id: "1", slug: "acme", name: "Acme Workspace" }],
      permissions: ["workspace.settings.view"],
      surfaceAccess: {
        consoleowner: true
      }
    },
    { source: "test.seed" }
  );
  const runtime = createTestRuntime({
    placementRuntime,
    router: createRouterStub("/w/acme/dashboard")
  });

  await runtime.initialize();
  await runtime.handleBootstrapError({
    request: createBootstrapRequest("/w/acme/dashboard", "acme"),
    error: createErrorWithStatus(404, "Workspace not found.")
  });

  const context = placementRuntime.getContext();
  assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND);
  assert.equal(context.workspaceBootstrapStatuses?.acme, WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND);
  assert.equal(context.workspace, null);
  assert.deepEqual(context.workspaces, []);
  assert.deepEqual(context.permissions, []);
  assert.equal(context.pendingInvitesCount, 0);
  assert.equal(context.workspaceInvitesEnabled, false);
  assert.deepEqual(context.surfaceAccess, {
    consoleowner: true
  });
});

test("bootstrap placement runtime tracks status per workspace slug across route changes", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/dashboard");
  const bootstrapRuntime = createBootstrapRuntimeStub();
  const runtime = createTestRuntime({ placementRuntime, bootstrapRuntime, router });

  await runtime.initialize();
  await runtime.applyBootstrapPayload({
    request: createBootstrapRequest("/w/acme/dashboard", "acme"),
    payload: {
      session: {
        authenticated: true,
        userId: "1"
      },
      workspaces: [{ id: "1", slug: "acme", name: "Workspace" }],
      permissions: []
    }
  });

  assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), WORKSPACE_BOOTSTRAP_STATUS_RESOLVED);

  router.currentRoute.value.path = "/w/zen/dashboard";
  router.currentRoute.value.fullPath = "/w/zen/dashboard";
  router.emitAfterEach();
  await flushTasks();
  assert.deepEqual(bootstrapRuntime.calls, ["route"]);

  await runtime.handleBootstrapError({
    request: createBootstrapRequest("/w/zen/dashboard", "zen"),
    error: createErrorWithStatus(404, "Workspace not found.")
  });

  const context = placementRuntime.getContext();
  assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), WORKSPACE_BOOTSTRAP_STATUS_RESOLVED);
  assert.equal(runtime.getWorkspaceBootstrapStatus("zen"), WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND);
  assert.equal(context.workspaceBootstrapStatuses?.acme, WORKSPACE_BOOTSTRAP_STATUS_RESOLVED);
  assert.equal(context.workspaceBootstrapStatuses?.zen, WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND);
  assert.deepEqual(router.replaceCalls, ["/w/zen"]);
});

// The person taps another page of the workspace before its bootstrap answer arrives. Before, the answer was dropped
// because the page had changed, and the move asked nothing again, so the person kept no permissions until a reload.
test("bootstrap placement runtime applies an answer that arrives after a move to another page of the same workspace", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/dashboard");
  const bootstrapRuntime = createBootstrapRuntimeStub();
  const runtime = createTestRuntime({ placementRuntime, bootstrapRuntime, router });
  const workspaces = [{ id: "1", slug: "acme", name: "Acme Workspace" }];

  await runtime.initialize();
  const request = runtime.resolveBootstrapRequest();
  await router.push("/w/acme/members");
  await flushTasks();
  assert.deepEqual(bootstrapRuntime.calls, [], "A move within the workspace asks nothing again.");

  await runtime.applyBootstrapPayload({
    request,
    payload: {
      session: { authenticated: true, userId: "7" },
      workspaces,
      permissions: ["workspace.members.view", "workspace.members.invite"]
    }
  });

  const context = placementRuntime.getContext();
  assert.deepEqual(context.permissions, ["workspace.members.view", "workspace.members.invite"]);
  assert.equal(context.workspace?.slug, "acme");
  assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), WORKSPACE_BOOTSTRAP_STATUS_RESOLVED);

  // An answer for a workspace the route has left is still dropped: the move there asked again.
  await router.push("/w/zen/dashboard");
  await flushTasks();
  await runtime.applyBootstrapPayload({
    request,
    payload: { session: { authenticated: true, userId: "7" }, workspaces, permissions: ["workspace.settings.view"] }
  });
  assert.deepEqual(bootstrapRuntime.calls, ["route"]);
  assert.deepEqual(placementRuntime.getContext().permissions, ["workspace.members.view", "workspace.members.invite"]);
});

test("bootstrap placement runtime applies a refusal that arrives after a move to another page of the same workspace", async () => {
  for (const [statusCode, status] of [[403, WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN], [404, WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND]]) {
    const placementRuntime = createPlacementRuntimeStub();
    placementRuntime.setContext({ permissions: ["workspace.members.view"] }, { source: "test.seed" });
    const router = createRouterStub("/w/acme/dashboard");
    const runtime = createTestRuntime({ placementRuntime, router });

    await runtime.initialize();
    const request = runtime.resolveBootstrapRequest();
    await router.push("/w/acme/members");
    await runtime.handleBootstrapError({ request, error: createErrorWithStatus(statusCode) });

    assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), status, `HTTP ${statusCode}`);
    assert.deepEqual(placementRuntime.getContext().permissions, [], `HTTP ${statusCode}`);
  }
});

test("bootstrap placement runtime uses requestedWorkspace status and keeps global workspace list on inaccessible slug", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/tony");
  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  await runtime.applyBootstrapPayload({
    request: createBootstrapRequest("/w/tony", "tony"),
    payload: {
      session: {
        authenticated: true,
        userId: "4"
      },
      profile: {
        displayName: "Chiara",
        email: "chiara@example.com",
        avatar: {
          effectiveUrl: ""
        }
      },
      workspaces: [{ id: "3", slug: "chiara", name: "Chiara Workspace" }],
      requestedWorkspace: {
        slug: "tony",
        status: "forbidden"
      },
      permissions: []
    }
  });

  const context = placementRuntime.getContext();
  assert.equal(runtime.getWorkspaceBootstrapStatus("tony"), WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN);
  assert.equal(context.workspaceBootstrapStatuses?.tony, WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN);
  assert.equal(context.workspace, null);
  assert.equal(Array.isArray(context.workspaces), true);
  assert.equal(context.workspaces.length, 1);
  assert.equal(context.workspaces[0]?.slug, "chiara");
});

test("bootstrap placement runtime uses requestedWorkspace=not_found without forcing forbidden fallback", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/missing");
  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  await runtime.applyBootstrapPayload({
    request: createBootstrapRequest("/w/missing", "missing"),
    payload: {
      session: {
        authenticated: true,
        userId: "1"
      },
      profile: {
        displayName: "User",
        email: "user@example.com",
        avatar: {
          effectiveUrl: ""
        }
      },
      workspaces: [{ id: "1", slug: "acme", name: "Acme Workspace" }],
      requestedWorkspace: {
        slug: "missing",
        status: "not_found"
      },
      permissions: []
    }
  });

  const context = placementRuntime.getContext();
  assert.equal(runtime.getWorkspaceBootstrapStatus("missing"), WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND);
  assert.equal(context.workspaceBootstrapStatuses?.missing, WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND);
  assert.equal(Array.isArray(context.workspaces), true);
  assert.equal(context.workspaces.length, 1);
  assert.equal(context.workspaces[0]?.slug, "acme");
});

test("bootstrap placement runtime stays on an unknown workspace URL until the server reports its status", async () => {
  for (const status of [WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND, WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN]) {
    const placementRuntime = createPlacementRuntimeStub();
    placementRuntime.setContext({
      surfaceConfig: {
        ...placementRuntime.getContext().surfaceConfig,
        defaultSurfaceId: "home"
      }
    });
    const router = createRouterStub("/w/acme");
    const runtime = createTestRuntime({ placementRuntime, router });
    const session = { authenticated: true, userId: "1" };
    const workspaces = [{ id: "1", slug: "acme", name: "Acme Workspace" }];

    await runtime.initialize();
    await runtime.applyBootstrapPayload({
      request: createBootstrapRequest("/w/acme", "acme"),
      payload: { session, workspaces, permissions: [] }
    });
    await router.push("/w/missing");
    await runtime.applyBootstrapPayload({
      request: createBootstrapRequest("/w/missing", "missing"),
      payload: {
        session,
        workspaces,
        requestedWorkspace: { slug: "missing", status },
        permissions: []
      }
    });

    assert.equal(runtime.getWorkspaceBootstrapStatus("missing"), status);
    assert.deepEqual(router.replaceCalls, ["/w/missing"]);
  }
});

test("bootstrap placement runtime guard wrapper preserves delegated deny outcomes", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/dashboard");
  const delegatedOutcome = Object.freeze({
    allow: false,
    redirectTo: "/auth/login?returnTo=%2Fw%2Facme%2Fdashboard",
    reason: "auth-required"
  });
  globalThis[SHELL_GUARD_EVALUATOR_KEY] = () => delegatedOutcome;

  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  await runtime.applyBootstrapPayload({
    request: createBootstrapRequest("/w/acme/dashboard", "acme"),
    payload: {
      session: {
        authenticated: true,
        userId: "1"
      },
      workspaces: [{ id: "1", slug: "acme", name: "Acme" }],
      permissions: []
    }
  });

  const evaluator = globalThis[SHELL_GUARD_EVALUATOR_KEY];
  const outcome = evaluator({
    guard: {
      policy: "authenticated"
    },
    context: {
      to: {
        path: "/w/acme/dashboard",
        fullPath: "/w/acme/dashboard"
      },
      location: {
        pathname: "/w/acme/dashboard",
        search: ""
      }
    }
  });

  assert.deepEqual(outcome, delegatedOutcome);
});

test("bootstrap placement runtime guard wrapper treats anything but a function in the shell slot as no guard", async () => {
  globalThis[SHELL_GUARD_EVALUATOR_KEY] = "not a function";

  const runtime = createTestRuntime({
    placementRuntime: createPlacementRuntimeStub(),
    router: createRouterStub("/home")
  });

  await runtime.initialize();

  const evaluator = globalThis[SHELL_GUARD_EVALUATOR_KEY];
  assert.equal(typeof evaluator, "function");
  assert.equal(
    evaluator({
      guard: {},
      context: {
        to: { path: "/home", fullPath: "/home" },
        location: { pathname: "/home", search: "" }
      }
    }),
    true
  );
});

test("bootstrap placement runtime guard wrapper blocks forbidden workspace routes and redirects nested workspace paths", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/admin/workspace/settings?tab=general");
  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  await runtime.handleBootstrapError({
    request: createBootstrapRequest("/w/acme/admin/workspace/settings?tab=general", "acme"),
    error: createErrorWithStatus(403, "Forbidden")
  });

  assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), WORKSPACE_BOOTSTRAP_STATUS_FORBIDDEN);
  assert.deepEqual(router.replaceCalls, ["/w/acme/admin"]);

  const evaluator = globalThis[SHELL_GUARD_EVALUATOR_KEY];
  const outcome = evaluator({
    guard: {
      policy: "authenticated"
    },
    context: {
      to: {
        path: "/w/acme/dashboard",
        fullPath: "/w/acme/dashboard?tab=general"
      },
      location: {
        pathname: "/w/acme/dashboard",
        search: "?tab=general"
      }
    }
  });

  assert.equal(outcome.allow, false);
  assert.equal(outcome.reason, "workspace-forbidden");
  assert.equal(outcome.redirectTo, "/w/acme");
});

test("bootstrap placement runtime guard wrapper redirects nested not_found routes to workspace surface root", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/projects");
  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  await runtime.handleBootstrapError({
    request: createBootstrapRequest("/w/acme/projects", "acme"),
    error: createErrorWithStatus(404, "Not found")
  });

  assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND);
  assert.deepEqual(router.replaceCalls, ["/w/acme"]);

  const evaluator = globalThis[SHELL_GUARD_EVALUATOR_KEY];
  const nestedOutcome = evaluator({
    guard: {
      policy: "authenticated"
    },
    context: {
      to: {
        path: "/w/acme/projects",
        fullPath: "/w/acme/projects"
      },
      location: {
        pathname: "/w/acme/projects",
        search: ""
      }
    }
  });
  assert.deepEqual(nestedOutcome, {
    allow: false,
    redirectTo: "/w/acme",
    reason: "workspace-not-found"
  });

  const rootOutcome = evaluator({
    guard: {
      policy: "authenticated"
    },
    context: {
      to: {
        path: "/w/acme",
        fullPath: "/w/acme"
      },
      location: {
        pathname: "/w/acme",
        search: ""
      }
    }
  });
  assert.equal(rootOutcome, true);
});

test("bootstrap placement runtime redirects admin nested route to admin root when workspace is not_found", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/w/acme/admin/workspace/settings");
  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  await runtime.handleBootstrapError({
    request: createBootstrapRequest("/w/acme/admin/workspace/settings", "acme"),
    error: createErrorWithStatus(404, "Not found")
  });

  assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), WORKSPACE_BOOTSTRAP_STATUS_NOT_FOUND);
  assert.deepEqual(router.replaceCalls, ["/w/acme/admin"]);
});

test("bootstrap placement runtime enforces surface access policies after bootstrap payloads", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  placementRuntime.setContext({
    auth: {
      authenticated: true
    },
    surfaceAccess: {
      opsowner: false
    },
    surfaceAccessPolicies: {
      public: {},
      ops_owner: {
        requireAuth: true,
        requireFlagsAll: ["ops_owner"]
      }
    },
    surfaceConfig: {
      tenancyMode: "workspaces",
      defaultSurfaceId: "home",
      enabledSurfaceIds: ["home", "ops"],
      surfacesById: {
        home: {
          id: "home",
          enabled: true,
          pagesRoot: "home",
          routeBase: "/home",
          requiresWorkspace: false,
          accessPolicyId: "public"
        },
        ops: {
          id: "ops",
          enabled: true,
          pagesRoot: "ops",
          routeBase: "/ops",
          requiresWorkspace: false,
          accessPolicyId: "ops_owner"
        }
      }
    }
  });
  const router = createRouterStub("/ops");
  const runtime = createTestRuntime({ placementRuntime, router });

  await runtime.initialize();
  await runtime.applyBootstrapPayload({
    request: createBootstrapRequest("/ops"),
    payload: {
      session: {
        authenticated: true,
        userId: "1"
      },
      workspaces: [],
      permissions: []
    }
  });

  assert.deepEqual(router.replaceCalls, ["/home"]);
});

test("bootstrap placement runtime handles unauthenticated errors and marks workspace status", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const runtime = createTestRuntime({
    placementRuntime,
    router: createRouterStub("/w/acme/dashboard")
  });

  await runtime.initialize();
  await runtime.handleBootstrapError({
    request: createBootstrapRequest("/w/acme/dashboard", "acme"),
    error: createErrorWithStatus(401, "Unauthenticated")
  });

  assert.equal(runtime.getWorkspaceBootstrapStatus("acme"), WORKSPACE_BOOTSTRAP_STATUS_UNAUTHENTICATED);
  assert.equal(placementRuntime.getContext().workspace, null);
});

/**
 * A real router whose replace stops navigating after `limit` calls, so a redirect loop ends and the test can count it.
 * Its pages load like an application's lazily imported ones, so every navigation takes several microtask turns.
 */
function createLoopLimitedRouter({ limit = 20, guard = null } = {}) {
  const page = { render: () => null };
  const loadPage = () => Promise.resolve(page);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ["/", "/home", "/ops", "/auth/login"].map((path) => ({ path, component: loadPage }))
  });
  if (guard) {
    router.beforeEach(guard);
  }
  const replaceCalls = [];
  const replace = router.replace.bind(router);
  router.replace = (target) => {
    replaceCalls.push(String(target));
    return replaceCalls.length > limit ? Promise.resolve() : replace(target);
  };
  return { router, replaceCalls };
}

function createSignInSurfaceContext({ authenticated = false, opsOwner = true } = {}) {
  return {
    auth: { authenticated },
    surfaceAccess: { opsowner: opsOwner },
    surfaceAccessPolicies: {
      public: {},
      authenticated: { requireAuth: true },
      ops_owner: { requireAuth: true, requireFlagsAll: ["ops_owner"] }
    },
    surfaceConfig: {
      tenancyMode: "workspaces",
      defaultSurfaceId: "home",
      enabledSurfaceIds: ["home", "ops", "auth"],
      surfacesById: {
        home: { id: "home", enabled: true, pagesRoot: "home", routeBase: "/home", requiresWorkspace: false, accessPolicyId: "authenticated" },
        ops: { id: "ops", enabled: true, pagesRoot: "ops", routeBase: "/ops", requiresWorkspace: false, accessPolicyId: "ops_owner" },
        auth: { id: "auth", enabled: true, pagesRoot: "auth", routeBase: "/auth", requiresWorkspace: false, accessPolicyId: "public" }
      }
    }
  };
}

test("bootstrap placement runtime leaves the opening navigation alone while the router still sits on its start location", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  placementRuntime.setContext(createSignInSurfaceContext());
  // The shell sends a signed-out person from the signed-in home to sign in.
  const { router, replaceCalls } = createLoopLimitedRouter({
    guard: (to) => (to.path === "/home" ? "/auth/login?returnTo=/home" : true)
  });
  const runtime = createTestRuntime({ placementRuntime, router });

  // Client providers boot just before app.use(router) starts the opening navigation to the page's own address,
  // so the runtime starts while router.currentRoute is still the start location "/", where nobody is.
  const initialized = runtime.initialize();
  const opening = router.push("/auth/login");
  await initialized;
  await opening;
  await router.isReady();
  await flushTasks();

  assert.deepEqual(replaceCalls, []);
  assert.equal(router.currentRoute.value.fullPath, "/auth/login");
});

test("bootstrap placement runtime does not redirect again when its own redirect is cancelled by a newer one", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  placementRuntime.setContext(createSignInSurfaceContext({ authenticated: true }));
  const { router, replaceCalls } = createLoopLimitedRouter();
  const runtime = createTestRuntime({ placementRuntime, router });
  await runtime.initialize();
  await router.push("/ops");
  await router.isReady();

  // The person loses the ops flag, and two bootstrap answers arrive together: each redirects to the home surface,
  // and the second cancels the first. The cancelled one must not start another redirect from the page it left.
  placementRuntime.setContext({ surfaceAccess: { opsowner: false } });
  const payload = { session: { authenticated: true, userId: "1" }, workspaces: [], permissions: [] };
  const first = runtime.applyBootstrapPayload({ request: createBootstrapRequest("/ops"), payload });
  const second = runtime.applyBootstrapPayload({ request: createBootstrapRequest("/ops"), payload });
  await Promise.all([first, second]);
  for (let turn = 0; turn < 5; turn += 1) {
    await flushTasks();
  }

  assert.deepEqual(replaceCalls, ["/home", "/home"]);
  assert.equal(router.currentRoute.value.fullPath, "/home");
});
