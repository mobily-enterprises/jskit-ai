import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceRuntime } from "../shared/surface/runtime.js";
import {
  bootstrapClientShellApp,
  createClientBootstrapLogger,
  createSurfaceShellRouter,
  shellScrollBehavior,
  staysOnSamePage
} from "./shellBootstrap.js";
import { getClientAppConfig } from "./appConfig.js";
import { silentLogger } from "../shared/support/silentLogger.js";

function createSurfaceRuntimeFixture() {
  return createSurfaceRuntime({
    allMode: "all",
    surfaces: {
      app: { id: "app", pagesRoot: "app", enabled: true },
      admin: { id: "admin", pagesRoot: "admin", enabled: true }
    },
    defaultSurfaceId: "app"
  });
}

test("createSurfaceShellRouter builds active routes and installs a guard", () => {
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const guards = [];
  const routerState = {
    options: null
  };

  const { router, activeRoutes, fallbackRoute } = createSurfaceShellRouter({
    createRouter(options) {
      routerState.options = options;
      return {
        beforeEach(guard) {
          guards.push(guard);
        }
      };
    },
    history: { kind: "memory" },
    routes: [
      {
        path: "/app/home",
        name: "app-home",
        component: {}
      },
      {
        path: "/admin/home",
        name: "admin-home",
        component: {}
      }
    ],
    surfaceRuntime,
    surfaceMode: "app",
    notFoundComponent: {},
    guard: {
      webRootAllowed: "yes"
    }
  });

  assert.ok(router);
  assert.equal(guards.length, 1);
  assert.equal(routerState.options.routes.length, activeRoutes.length);
  assert.equal(activeRoutes.some((route) => route.path === "/app/home"), true);
  assert.equal(activeRoutes.some((route) => route.path === "/admin/home"), false);
  assert.equal(activeRoutes.some((route) => route.path === "/:pathMatch(.*)*"), true);
  assert.equal(fallbackRoute.path, "/:pathMatch(.*)*");
  assert.equal(routerState.options.scrollBehavior, shellScrollBehavior);
});

test("createSurfaceShellRouter lets an app replace or disable the scroll behaviour", () => {
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const custom = () => ({ top: 42 });
  const seen = [];
  for (const scrollBehavior of [custom, false]) {
    createSurfaceShellRouter({
      createRouter(options) {
        seen.push(options);
        return {};
      },
      routes: [],
      surfaceRuntime,
      surfaceMode: "app",
      notFoundComponent: {},
      scrollBehavior
    });
  }
  assert.equal(seen[0].scrollBehavior, custom);
  assert.equal(Object.hasOwn(seen[1], "scrollBehavior"), false);
});

test("createSurfaceShellRouter refuses a createRouter that replaces the scroll behaviour it is given", () => {
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const own = () => ({ top: 7 });
  const build = (createRouter, scrollBehavior) =>
    createSurfaceShellRouter({ createRouter, routes: [], surfaceRuntime, surfaceMode: "app", notFoundComponent: {}, scrollBehavior });
  // A wrapper that sets its own scrollBehavior, as vue-router keeps it in router.options.
  const wrapper = (options) => ({ options: { ...options, scrollBehavior: own } });
  assert.throws(() => build(wrapper), /replaced the scroll behaviour it was given[\s\S]*createShellRouter's scrollBehavior option/u);
  assert.throws(() => build((options) => ({ options: { routes: options.routes } })), /replaced the scroll behaviour/u);
  // The router keeps what it was given: the shell's, the app's own passed as the option, or none for false.
  const keeps = (options) => ({ options });
  assert.equal(build(keeps).router.options.scrollBehavior, shellScrollBehavior);
  assert.equal(build(keeps, own).router.options.scrollBehavior, own);
  assert.equal(build(wrapper, false).router.options.scrollBehavior, own);
});

test("createSurfaceShellRouter installs an application's own guard function as it is given", () => {
  const ownGuard = () => true;
  const guards = [];
  createSurfaceShellRouter({
    createRouter() {
      return {
        beforeEach(guard) {
          guards.push(guard);
        }
      };
    },
    routes: [],
    surfaceRuntime: createSurfaceRuntimeFixture(),
    surfaceMode: "app",
    notFoundComponent: {},
    guard: ownGuard
  });
  assert.deepEqual(guards, [ownGuard]);
});

// A page's window as shellScrollBehavior reads it: its history state, how far its document is drawn (an 800px-tall
// window), its hash targets and their scroll-margin-top, and the frames and listeners it is given.
function createPageWindow({ state = {}, scrollHeight = 10_000, targets = {} } = {}) {
  const frames = [];
  const listeners = new Map();
  const page = {
    history: { state },
    innerHeight: 800,
    innerWidth: 390,
    document: {
      documentElement: { scrollHeight, scrollWidth: 390 },
      getElementById: (id) => (targets[id] ? { id } : null)
    },
    getComputedStyle: (element) => targets[element.id],
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    }
  };
  return { page, frames, listeners, nextFrame: () => frames.shift()() };
}

test("shellScrollBehavior opens new screens at the top and keeps in-page changes still", () => {
  const surface = { path: "/home", meta: { jskit: { surface: "home" } } };
  const settings = { path: "/home/settings", meta: {}, components: { default: {} } };
  const general = { path: "/home/settings/general", meta: {} };
  const profile = { path: "/home/settings/profile", meta: {} };
  const contacts = { path: "/home/contacts", meta: {} };
  const contact = { path: "/home/contacts/:id", meta: {} };
  const at = (path, matched, extra = {}) => ({ path, matched, hash: "", ...extra });

  const saved = { left: 0, top: 640 };
  assert.equal(shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home", [surface]), saved), saved);
  assert.deepEqual(shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home", [surface]), null), { top: 0 });
  // Another record of the same screen type is still a new screen.
  assert.deepEqual(
    shellScrollBehavior(at("/home/contacts/2", [surface, contact]), at("/home/contacts/1", [surface, contact]), null),
    { top: 0 }
  );
  // Query, hash or tab changes within one page keep the position.
  assert.equal(shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home/contacts", [surface, contacts]), null), false);
  assert.equal(
    shellScrollBehavior(at("/home/settings/profile", [surface, settings, profile]), at("/home/settings/general", [surface, settings, general]), null),
    false
  );
  assert.deepEqual(
    shellScrollBehavior(at("/home/contacts", [surface, contacts], { hash: "#recent" }), at("/home", [surface]), null),
    { el: "#recent", top: 0 }
  );
});

test("shellScrollBehavior opens a hash target below its scroll-margin-top", (t) => {
  const surface = { path: "/home", meta: { jskit: { surface: "home" } } };
  const contacts = { path: "/home/contacts", meta: {} };
  const at = (path, matched, hash = "") => ({ path, matched, hash });
  const previousWindow = globalThis.window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  const targets = { recent: { scrollMarginTop: "72px" }, plain: { scrollMarginTop: "0px" } };
  globalThis.window = createPageWindow({ targets }).page;
  const open = (hash) => shellScrollBehavior(at("/home/contacts", [surface, contacts], hash), at("/home", [surface]), null);
  assert.deepEqual(open("#recent"), { el: "#recent", top: 72 });
  assert.deepEqual(open("#plain"), { el: "#plain", top: 0 });
});

// vue-router scrolls once the new route renders, before a page draws the content it loads: a list fetching its rows is
// still short then, and a position below its first screen would land at its end.
test("shellScrollBehavior waits for the page to draw a position it restores or a hash target", async (t) => {
  const surface = { path: "/home", meta: { jskit: { surface: "home" } } };
  const contacts = { path: "/home/contacts", meta: {} };
  const contact = { path: "/home/contacts/:id", meta: {} };
  const at = (path, matched, hash = "") => ({ path, matched, hash });
  const backToList = (saved = null) =>
    shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home/contacts/1", [surface, contact]), saved);
  const previousWindow = globalThis.window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  let now = 0;
  t.mock.method(Date, "now", () => now);

  // Up returns to a list still drawing its rows: the position waits until the page reaches it.
  const list = createPageWindow({ state: { restoreScroll: { left: 0, top: 1313 } }, scrollHeight: 900 });
  globalThis.window = list.page;
  const restored = backToList();
  assert.ok(restored instanceof Promise, "a position the page cannot reach yet waits");
  list.nextFrame();
  assert.equal(list.frames.length, 1, "it checks again on the next frame");
  list.page.document.documentElement.scrollHeight = 2400;
  list.nextFrame();
  assert.deepEqual(await restored, { left: 0, top: 1313 });
  assert.equal(list.frames.length, 0);
  assert.equal(list.listeners.size, 0, "it stops listening once it has scrolled");

  // Back's saved position waits the same way, and a page that never gets that tall scrolls as far as it goes at 1.5 s.
  const short = createPageWindow({ scrollHeight: 900 });
  globalThis.window = short.page;
  const saved = { left: 0, top: 640 };
  const back = backToList(saved);
  now = 1499;
  short.nextFrame();
  assert.equal(short.frames.length, 1);
  now = 1500;
  short.nextFrame();
  assert.equal(await back, saved);

  // Someone who moves the page meanwhile keeps it where they put it.
  now = 0;
  const moved = createPageWindow({ state: { restoreScroll: { left: 0, top: 1313 } }, scrollHeight: 900 });
  globalThis.window = moved.page;
  const taken = backToList();
  assert.deepEqual([...moved.listeners.keys()], ["wheel", "touchstart", "keydown", "pointerdown"]);
  moved.listeners.get("wheel")();
  assert.equal(await taken, false);
  assert.equal(moved.listeners.size, 0);

  // A hash target waits until the page draws it, then opens below its scroll-margin-top.
  const targets = {};
  const hashed = createPageWindow({ targets });
  globalThis.window = hashed.page;
  const opened = shellScrollBehavior(at("/home/contacts", [surface, contacts], "#recent"), at("/home", [surface]), null);
  assert.ok(opened instanceof Promise);
  targets.recent = { scrollMarginTop: "72px" };
  hashed.nextFrame();
  assert.deepEqual(await opened, { el: "#recent", top: 72 });

  // A position the page already reaches, and a new screen, scroll at once.
  globalThis.window = createPageWindow({ state: { restoreScroll: { left: 0, top: 420 } } }).page;
  assert.deepEqual(backToList(), { left: 0, top: 420 });
  globalThis.window = createPageWindow({ scrollHeight: 0 }).page;
  assert.deepEqual(backToList(), { top: 0 });
});

test("shellScrollBehavior opens a page Up returns to at the position its navigation state carries", (t) => {
  const surface = { path: "/home", meta: { jskit: { surface: "home" } } };
  const contacts = { path: "/home/contacts", meta: {} };
  const contact = { path: "/home/contacts/:id", meta: {} };
  const at = (path, matched) => ({ path, matched, hash: "" });
  const previousWindow = globalThis.window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  globalThis.window = createPageWindow({ state: { restoreScroll: { left: 0, top: 420 } } }).page;
  assert.deepEqual(
    shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home/contacts/1", [surface, contact]), null),
    { left: 0, top: 420 }
  );
  // Back/Forward keep their own saved position, and an in-page change keeps the current one.
  const saved = { left: 0, top: 10 };
  assert.equal(shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home/contacts/1", [surface, contact]), saved), saved);
  assert.equal(shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home/contacts", [surface, contacts]), null), false);
  globalThis.window = { history: { state: {} } };
  assert.deepEqual(
    shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home/contacts/1", [surface, contact]), null),
    { top: 0 }
  );
});

test("staysOnSamePage tells tabs of one page from different pages", () => {
  const surface = { path: "/home", meta: { jskit: { surface: "home" } } };
  const settings = { path: "/home/settings", meta: {}, components: { default: {} } };
  const general = { path: "/home/settings/general", meta: {} };
  const profile = { path: "/home/settings/profile", meta: {} };
  const contacts = { path: "/home/contacts", meta: {} };
  const at = (path, matched) => ({ path, matched });
  assert.equal(staysOnSamePage(at("/home/settings/profile", [surface, settings, profile]), at("/home/settings/general", [surface, settings, general])), true);
  assert.equal(staysOnSamePage(at("/home/contacts", [surface, contacts]), at("/home/settings/general", [surface, settings, general])), false);
  assert.equal(staysOnSamePage(at("/home/contacts", [surface, contacts]), at("/home/contacts", [surface, contacts])), true);
});

// File routing groups a folder's routes (/w/bookings/, /w/day/) under a record that draws no component; only a layout
// that hosts tabs or sub-views, and so draws one, makes its children one page.
test("shellScrollBehavior opens a page in a route folder at the top and lets Up restore the page it returns to", (t) => {
  const page = {};
  const surface = { path: "/w", meta: { jskit: { surface: "w" } }, components: { default: page } };
  const day = { path: "/w/day", meta: {} };
  const overview = { path: "/w/day/overview", meta: {}, components: { default: page } };
  const bookings = { path: "/w/bookings", meta: {}, components: undefined };
  const bookingList = { path: "/w/bookings/", meta: {}, components: { default: page } };
  const booking = { path: "/w/bookings/:id", meta: {}, components: { default: page } };
  const roster = { path: "/w/day/roster", meta: {}, components: { default: page } };
  const at = (path, matched) => ({ path, matched, hash: "" });
  const previousWindow = globalThis.window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  globalThis.window = { history: { state: {} } };
  assert.equal(staysOnSamePage(at("/w/bookings/7", [surface, bookings, booking]), at("/w/bookings/", [surface, bookings, bookingList])), false);
  assert.deepEqual(
    shellScrollBehavior(at("/w/bookings/7", [surface, bookings, booking]), at("/w/bookings/", [surface, bookings, bookingList]), null),
    { top: 0 }
  );
  assert.deepEqual(
    shellScrollBehavior(at("/w/day/roster", [surface, day, roster]), at("/w/day/overview", [surface, day, overview]), null),
    { top: 0 }
  );
  globalThis.window = createPageWindow({ state: { restoreScroll: { left: 0, top: 1313 } } }).page;
  assert.deepEqual(
    shellScrollBehavior(at("/w/day/overview", [surface, day, overview]), at("/w/day/roster", [surface, day, roster]), null),
    { left: 0, top: 1313 }
  );

  // A layout in a folder that hosts tabs still keeps its tabs one page.
  const settings = { path: "/w/settings", meta: {}, components: { default: page } };
  const general = { path: "/w/settings/general", meta: {}, components: { default: page } };
  const profile = { path: "/w/settings/profile", meta: {}, components: { default: page } };
  assert.equal(
    shellScrollBehavior(at("/w/settings/profile", [surface, settings, profile]), at("/w/settings/general", [surface, settings, general]), null),
    false
  );
});

test("createClientBootstrapLogger enables debug from env flag", () => {
  const logger = createClientBootstrapLogger({
    env: { VITE_JSKIT_CLIENT_DEBUG: "1" },
    logger: silentLogger
  });

  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.debug, "function");
  assert.equal(logger.isDebugEnabled, true);
});

test("bootstrapClientShellApp hands hooks and modules one logger that carries its debug flag", async () => {
  for (const debugEnabled of [false, true]) {
    let routeTableReads = 0;
    const seenLoggers = [];
    const router = {
      addRoute() {},
      getRoutes() {
        routeTableReads += 1;
        return [];
      },
      async isReady() {}
    };
    const result = await bootstrapClientShellApp({
      createApp: () => ({ use() {}, mount() {} }),
      router,
      surfaceRuntime: createSurfaceRuntimeFixture(),
      logger: silentLogger,
      debugEnabled,
      bootClientModules: async ({ logger }) => {
        seenLoggers.push(logger);
        return {};
      },
      onAfterRouterReady: ({ logger }) => seenLoggers.push(logger)
    });

    assert.equal(result.debugEnabled, debugEnabled);
    assert.equal(result.logger.isDebugEnabled, debugEnabled);
    assert.deepEqual(seenLoggers, [result.logger, result.logger]);
    assert.equal(routeTableReads > 0, debugEnabled);
  }
});

test("bootstrapClientShellApp boots modules, reinstalls fallback route, and mounts app", async () => {
  const calls = [];
  const logs = [];
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const plugin = { name: "vuetify-like-plugin" };
  const pinia = { id: "pinia-instance" };
  const queryClient = { id: "query-client-instance" };
  const fallbackRoute = {
    name: "not-found",
    path: "/:pathMatch(.*)*",
    component: {}
  };

  const app = {
    used: [],
    mountedAt: "",
    use(entry) {
      this.used.push(entry);
      return this;
    },
    mount(selector) {
      this.mountedAt = selector;
      calls.push(`mount:${selector}`);
    }
  };

  const router = {
    routes: [fallbackRoute],
    addRoute(route) {
      calls.push(`add:${route.name || route.path}`);
      this.routes.push(route);
    },
    hasRoute(name) {
      return this.routes.some((route) => String(route?.name || "") === String(name || ""));
    },
    removeRoute(name) {
      calls.push(`remove:${name}`);
      this.routes = this.routes.filter((route) => String(route?.name || "") !== String(name || ""));
    },
    getRoutes() {
      return [...this.routes];
    },
    async isReady() {
      calls.push("isReady");
    }
  };

  const result = await bootstrapClientShellApp({
    createApp(rootComponent) {
      calls.push(`createApp:${String(rootComponent || "")}`);
      return app;
    },
    rootComponent: "RootComponent",
    appConfig: {
      crud: {
        contacts: {
          namespace: "crm",
          visibility: "workspace"
        }
      }
    },
    appPlugins: [plugin],
    pinia,
    queryClient,
    router,
    bootClientModules: async (context) => {
      calls.push("bootClientModules");
      assert.equal(context.app, app);
      assert.equal(context.pinia, pinia);
      assert.equal(context.queryClient, queryClient);
      assert.equal(context.router, router);
      assert.equal(typeof context.logger.debug, "function");
      return {
        modules: ["@example/main"],
        providerCount: 1,
        routeCount: 3
      };
    },
    surfaceRuntime,
    surfaceMode: "app",
    env: { VITE_JSKIT_CLIENT_DEBUG: "1" },
    fallbackRoute,
    logger: {
      info(payload, message) {
        logs.push({ payload, message });
      },
      warn() {},
      error() {},
      debug() {}
    },
    onAfterModulesBootstrapped(context) {
      calls.push(`after:${context.clientBootstrap.routeCount}`);
    },
    onAfterRouterReady(context) {
      calls.push(`router-ready:${context.clientBootstrap.routeCount}`);
    }
  });

  assert.equal(result.debugEnabled, true);
  assert.deepEqual(getClientAppConfig().crud?.contacts, {
    namespace: "crm",
    visibility: "workspace"
  });
  assert.equal(app.used[0], plugin);
  assert.equal(app.used[1], router);
  assert.equal(app.mountedAt, "#app");
  assert.equal(logs.length, 1);
  assert.equal(calls.includes("bootClientModules"), true);
  assert.equal(calls.includes("remove:not-found"), true);
  assert.equal(calls.includes("add:not-found"), true);
  assert.equal(calls.includes("isReady"), true);
  assert.equal(calls.includes("after:3"), true);
  assert.equal(calls.includes("router-ready:3"), true);
});

test("bootstrapClientShellApp starts loading the opening page's code before the client modules boot", async () => {
  const loads = [];
  const loader = (name) => () => {
    loads.push(name);
    return Promise.resolve({ default: { name } });
  };
  const notFound = loader("not-found");
  const matchedByLocation = {
    "/home": [
      { name: "home-layout", components: { default: loader("layout") } },
      { name: "home", components: { default: loader("page"), aside: { name: "RenderedAside" } } }
    ],
    "/auth/login": [{ name: "not-found", components: { default: notFound } }]
  };

  for (const [location, expected] of [["/home", ["layout", "page"]], ["/auth/login", []]]) {
    loads.length = 0;
    let loadedWhenModulesBoot = null;
    await bootstrapClientShellApp({
      createApp: () => ({ use() {}, mount() {} }),
      router: {
        options: { history: { location } },
        resolve: (to) => ({ matched: matchedByLocation[to] }),
        addRoute() {},
        hasRoute: () => false,
        removeRoute() {},
        getRoutes: () => [],
        async isReady() {}
      },
      surfaceRuntime: createSurfaceRuntimeFixture(),
      logger: silentLogger,
      fallbackRoute: { name: "not-found", path: "/:pathMatch(.*)*", component: notFound },
      bootClientModules: async () => {
        await Promise.resolve();
        loadedWhenModulesBoot = [...loads];
        return {};
      }
    });

    assert.deepEqual(loadedWhenModulesBoot, expected, location);
  }
});

test("bootstrapClientShellApp installs the app's vue-i18n once and translates JSKIT through it", async () => {
  const { createI18n } = await import("vue-i18n");
  const { registerJskitMessages, useJskitText } = await import("./i18n.js");
  registerJskitMessages({ jskit: { shell: { back: "Back" } } });
  const i18n = createI18n({ legacy: false, locale: "it", messages: { it: { jskit: { shell: { back: "Indietro" } } } } });
  for (const appPlugins of [[], [i18n]]) {
    const used = [];
    await bootstrapClientShellApp({
      createApp: () => ({ use(plugin) { used.push(plugin); }, mount() {} }),
      router: { addRoute() {}, getRoutes: () => [], async isReady() {} },
      surfaceRuntime: createSurfaceRuntimeFixture(),
      logger: silentLogger,
      appPlugins,
      i18n,
      bootClientModules: async () => ({})
    });
    assert.equal(used.filter((plugin) => plugin === i18n).length, 1);
  }
  assert.equal(useJskitText().t("jskit.shell.back"), "Indietro");
  assert.equal(i18n.global.getLocaleMessage("en").jskit.shell.back, "Back");
  delete globalThis.__JSKIT_CLIENT_I18N__;
});
