import assert from "node:assert/strict";
import test from "node:test";
import { nextTick, ref, watch } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  createBrowserSessionNavigationStorage,
  createJskitNavigationScrollCoordinator,
  installJskitNavigation
} from "./navigation.js";

function createDestinationRecordingStorage(destinationPrincipals) {
  const base = createBrowserSessionNavigationStorage({ storage: null, logger: createLogger() });
  return Object.freeze({
    ...base,
    async writeDestination(entry) {
      destinationPrincipals.push(entry.scope.principal);
      return base.writeDestination(entry);
    }
  });
}

function routeMeta(behavior, key, extra = {}) {
  return {
    jskit: {
      surface: "admin",
      navigation: {
        behavior,
        ...(behavior === "destination" ? { destinationKey: key } : {}),
        ...(behavior === "preserve" ? { machineryKey: key } : {}),
        scope: ["principal", "surface", "workspace"],
        ...extra
      }
    }
  };
}

function createRoutes() {
  return [
    {
      path: "/queue",
      name: "queue",
      component: {},
      meta: routeMeta("destination", "work.queue", {
        restore: ["work.queue.v1"],
        persistence: { mode: "snapshot", queryAllowlist: ["q", "status"] }
      })
    },
    {
      path: "/pet/:petId",
      name: "pet",
      component: {},
      meta: routeMeta("destination", "record.pet", {
        fallback: { name: "queue" },
        persistence: { mode: "url-only", queryAllowlist: [] }
      })
    },
    {
      path: "/owner/:ownerId",
      name: "owner",
      component: {},
      meta: routeMeta("destination", "record.owner", {
        fallback: { name: "queue" },
        persistence: { mode: "snapshot", queryAllowlist: [] }
      })
    },
    {
      path: "/pet/:petId/edit",
      name: "pet-edit",
      component: {},
      meta: routeMeta("preserve", "record.pet.edit", {
        fallback: { name: "pet", params: { petId: "direct" } },
        persistence: { mode: "url-only", queryAllowlist: [] }
      })
    },
    { path: "/pet-alias/:petId", redirect: (to) => ({ name: "pet", params: to.params }) },
    {
      path: "/auth/callback",
      name: "auth-callback",
      component: {},
      meta: routeMeta("boundary", "", { persistence: { mode: "none" } })
    }
  ];
}

function createCryptoSequence() {
  let sequence = 0;
  return {
    randomUUID() {
      sequence += 1;
      return `id-${sequence}`;
    }
  };
}

function createWindowDouble() {
  const listeners = new Map();
  const scrollCalls = [];
  return {
    scrollX: 0,
    scrollY: 0,
    scrollCalls,
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    scrollTo(x, y) {
      scrollCalls.push({ x, y });
      this.scrollX = x;
      this.scrollY = y;
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) {
        handler(event);
      }
    }
  };
}

function createLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

async function waitFor(predicate, message = "navigation state") {
  if (predicate()) {
    return;
  }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stop();
      reject(new Error(`Timed out waiting for ${message}.`));
    }, 1500);
    const stop = watch(
      predicate,
      (ready) => {
        if (ready) {
          clearTimeout(timeout);
          stop();
          resolve();
        }
      },
      { immediate: true }
    );
  });
}

async function createFixture({
  initial = "/queue",
  storage = null,
  scopeResolver = null,
  windowObject = createWindowDouble(),
  documentObject = null,
  historyBase = "/",
  limits = undefined,
  cryptoObject = createCryptoSequence()
} = {}) {
  const history = createMemoryHistory(historyBase);
  const router = createRouter({
    history,
    routes: createRoutes(),
    scrollBehavior: createJskitNavigationScrollCoordinator().scrollBehavior
  });
  const repository = storage || createBrowserSessionNavigationStorage({ storage: null, logger: createLogger() });
  const scrollCoordinator = createJskitNavigationScrollCoordinator();
  const navigation = installJskitNavigation({
    router,
    history,
    storage: repository,
    scopeResolver: scopeResolver || (() => ({ principal: "p1", surface: "admin", workspace: "w1" })),
    scrollCoordinator,
    cryptoObject,
    windowObject,
    documentObject,
    limits,
    logger: createLogger()
  });
  await router.push(initial);
  await router.isReady();
  await navigation.initialize();
  navigation.notifyAppMounted();
  return { history, router, navigation, storage: repository, windowObject };
}

test("default scope resolution preserves parent surface metadata hidden by Vue Router's shallow merge", async () => {
  const history = createMemoryHistory();
  const router = createRouter({
    history,
    routes: [
      {
        path: "/home",
        component: {},
        meta: { jskit: { surface: "home" } },
        children: [
          {
            path: "work",
            name: "nested-work",
            component: {},
            meta: {
              jskit: {
                navigation: {
                  behavior: "destination",
                  destinationKey: "nested.work",
                  scope: ["surface"],
                  persistence: { mode: "url-only", queryAllowlist: [] }
                }
              }
            }
          },
          {
            path: "items/:itemId",
            name: "nested-item",
            component: {},
            meta: {
              jskit: {
                navigation: {
                  behavior: "destination",
                  destinationKey: "nested.item",
                  scope: ["surface"],
                  persistence: { mode: "url-only", queryAllowlist: [] }
                }
              }
            }
          }
        ]
      }
    ]
  });
  const navigation = installJskitNavigation({
    router,
    history,
    storage: createBrowserSessionNavigationStorage({ storage: null, logger: createLogger() }),
    scrollCoordinator: createJskitNavigationScrollCoordinator(),
    cryptoObject: createCryptoSequence(),
    windowObject: createWindowDouble(),
    documentObject: null,
    logger: createLogger()
  });

  await router.push("/home/work");
  await router.isReady();
  await navigation.initialize();
  await navigation.push({ name: "nested-item", params: { itemId: "9011" } });

  assert.equal(navigation.state.activeEntry.scope.surface, "home");
  assert.equal(navigation.state.previousEntry.destinationKey, "nested.work");
  assert.equal(navigation.state.canPop, true);
  navigation.dispose();
});

test("runtime stamps one browser-synchronized destination trail and preserves sibling history state", async () => {
  const history = createMemoryHistory("/app/");
  const router = createRouter({ history, routes: createRoutes() });
  const navigation = installJskitNavigation({
    router,
    history,
    storage: createBrowserSessionNavigationStorage({ storage: null, logger: createLogger() }),
    scopeResolver: () => ({ principal: "p1", surface: "admin", workspace: "w1" }),
    scrollCoordinator: createJskitNavigationScrollCoordinator(),
    cryptoObject: createCryptoSequence(),
    windowObject: createWindowDouble(),
    documentObject: null,
    logger: createLogger()
  });
  assert.equal(
    installJskitNavigation({ router, history }),
    navigation,
    "reinstallation returns the exact runtime"
  );

  await router.push("/queue?q=Biscuit&status=confirmed");
  await router.isReady();
  history.replace(history.location, {
    ...(history.state || {}),
    siblingLibrary: { scroll: { top: 40 } }
  });
  await navigation.initialize();
  navigation.notifyAppMounted();

  assert.equal(navigation.state.activeEntry.destinationKey, "work.queue");
  assert.equal(navigation.state.canPop, false);
  assert.deepEqual(history.state.siblingLibrary, { scroll: { top: 40 } });
  assert.equal(history.state.__jskit.navigation.kind, "destination");

  const queueDestinationId = navigation.state.activeEntry.destinationEntryId;
  await navigation.push({ name: "pet", params: { petId: 7 } });
  const petDestinationId = navigation.state.activeEntry.destinationEntryId;
  await navigation.push({ name: "owner", params: { ownerId: 9 } });

  assert.equal(navigation.state.activeEntry.destinationKey, "record.owner");
  assert.equal(navigation.state.previousEntry.destinationKey, "record.pet");
  assert.equal(navigation.state.canPop, true);
  assert.notEqual(petDestinationId, queueDestinationId);

  const ownerDestinationId = navigation.state.activeEntry.destinationEntryId;
  const result = await navigation.goUp();
  assert.equal(result.status, "completed");
  assert.equal(router.currentRoute.value.name, "pet");
  assert.equal(navigation.state.activeEntry.destinationEntryId, petDestinationId);

  router.forward();
  await waitFor(() => navigation.state.activeEntry?.destinationEntryId === ownerDestinationId, "forward destination");
  assert.equal(router.currentRoute.value.name, "owner");
  navigation.dispose();
});

test("concurrent initialization classifies and stamps the initial route once", async () => {
  const history = createMemoryHistory();
  const router = createRouter({ history, routes: createRoutes() });
  const storage = createBrowserSessionNavigationStorage({ storage: null, logger: createLogger() });
  const scopeGate = createDeferredGate();
  let scopeCalls = 0;
  const navigation = installJskitNavigation({
    router,
    history,
    storage,
    async scopeResolver() {
      scopeCalls += 1;
      await scopeGate.promise;
      return { principal: "p1", surface: "admin", workspace: "w1" };
    },
    scrollCoordinator: createJskitNavigationScrollCoordinator(),
    cryptoObject: createCryptoSequence(),
    windowObject: createWindowDouble(),
    documentObject: null,
    logger: createLogger()
  });
  await router.push("/queue");
  await router.isReady();

  const first = navigation.initialize();
  const second = navigation.initialize();
  scopeGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [navigation, navigation]);
  assert.equal(scopeCalls, 1);
  const task = await storage.readTask(navigation.taskId);
  assert.equal(Object.keys(task.browserEntries).length, 1);
  navigation.dispose();
});

test("preserving machinery keeps the owning destination and consumes one native entry at a time", async () => {
  const { router, navigation } = await createFixture();
  await navigation.push({ name: "pet", params: { petId: 7 } });
  const petDestinationId = navigation.state.activeEntry.destinationEntryId;
  await navigation.preserve({ name: "pet-edit", params: { petId: 7 } });

  assert.equal(router.currentRoute.value.name, "pet-edit");
  assert.equal(navigation.state.activeEntry.destinationEntryId, petDestinationId);
  assert.equal(navigation.state.previousEntry.destinationEntryId, petDestinationId);
  assert.equal(navigation.state.canPop, true);

  await navigation.goUp();
  assert.equal(router.currentRoute.value.name, "pet");
  assert.equal(navigation.state.activeEntry.destinationEntryId, petDestinationId);
  await navigation.goUp();
  assert.equal(router.currentRoute.value.name, "queue");
  navigation.dispose();
});

test("replacing an internal machinery step preserves the one native browser-entry identity", async () => {
  const { history, router, navigation } = await createFixture();
  await navigation.push({ name: "pet", params: { petId: 7 } });
  await navigation.preserve({ name: "pet-edit", params: { petId: 7 } });
  const editEnvelope = structuredClone(history.state.__jskit.navigation);

  await navigation.preserve(
    { name: "pet-edit", params: { petId: 7 }, query: { step: "review" } },
    { replaceCurrentBrowserEntry: true }
  );

  assert.equal(history.state.__jskit.navigation.browserEntryId, editEnvelope.browserEntryId);
  assert.equal(
    history.state.__jskit.navigation.previousJskitBrowserEntryId,
    editEnvelope.previousJskitBrowserEntryId
  );
  await navigation.goUp();
  assert.equal(router.currentRoute.value.name, "pet");
  navigation.dispose();
});

test("direct destination and ownerless machinery use one replace-only synthetic fallback", async () => {
  const direct = await createFixture({ initial: "/pet/7" });
  const initialBrowserEntryId = direct.history.state.__jskit.navigation.browserEntryId;
  assert.equal(direct.navigation.state.canPop, false);
  assert.equal(direct.navigation.state.canGoUp, true);

  await direct.navigation.goUp();
  assert.equal(direct.router.currentRoute.value.name, "queue");
  assert.equal(direct.navigation.state.canPop, false);
  assert.equal(direct.history.state.__jskit.navigation.browserEntryId, initialBrowserEntryId);
  direct.navigation.dispose();

  const machinery = await createFixture({ initial: "/pet/7/edit" });
  assert.equal(machinery.navigation.state.activeEntry, null);
  assert.equal(machinery.history.state.__jskit.navigation.kind, "machinery");
  assert.equal(machinery.history.state.__jskit.navigation.destinationEntryId, undefined);
  assert.equal(machinery.navigation.state.canGoUp, true);
  await machinery.navigation.goUp();
  assert.equal(machinery.router.currentRoute.value.name, "pet");
  assert.equal(machinery.navigation.state.activeEntry.destinationKey, "record.pet");
  assert.equal(machinery.navigation.state.canPop, false);
  machinery.navigation.dispose();
});

test("a reload envelope for another route is discarded instead of being reclassified", async () => {
  const storage = createBrowserSessionNavigationStorage({ storage: null, logger: createLogger() });
  const cryptoObject = createCryptoSequence();
  const queue = await createFixture({ storage, cryptoObject });
  const queueTaskId = queue.navigation.taskId;
  const staleQueueState = structuredClone(queue.history.state);
  queue.navigation.dispose();

  const history = createMemoryHistory();
  const router = createRouter({ history, routes: createRoutes() });
  await router.push("/owner/9");
  await router.isReady();
  history.replace(history.location, staleQueueState);
  const navigation = installJskitNavigation({
    router,
    history,
    storage,
    scopeResolver: () => ({ principal: "p1", surface: "admin", workspace: "w1" }),
    scrollCoordinator: createJskitNavigationScrollCoordinator(),
    cryptoObject,
    windowObject: createWindowDouble(),
    documentObject: null,
    logger: createLogger()
  });

  await navigation.initialize();
  assert.equal(navigation.state.activeEntry.destinationKey, "record.owner");
  assert.notEqual(navigation.taskId, queueTaskId);
  assert.equal(navigation.state.canPop, false);
  assert.equal(await storage.readTask(queueTaskId), null);
  navigation.dispose();
});

test("URL-only destinations retain their canonical hash without storing contributor snapshots", async () => {
  const { navigation } = await createFixture();

  await navigation.push({ name: "pet", params: { petId: 7 }, hash: "#details" });

  assert.equal(navigation.state.activeEntry.fullPath, "/pet/7#details");
  assert.equal((await navigation.capture()).reason, "persistence-url-only");
  navigation.dispose();
});

test("redirects stamp only the final destination and guard cancellation leaves the active entry unchanged", async () => {
  const { router, navigation } = await createFixture();
  const queueBrowserEntryId = router.options.history.state.__jskit.navigation.browserEntryId;
  await navigation.push({ path: "/pet-alias/7" });
  assert.equal(router.currentRoute.value.name, "pet");
  assert.equal(navigation.state.activeEntry.destinationKey, "record.pet");
  assert.equal(router.options.history.state.__jskit.navigation.previousJskitBrowserEntryId, queueBrowserEntryId);

  const petDestinationId = navigation.state.activeEntry.destinationEntryId;
  const removeGuard = router.beforeEach((to) => (to.name === "owner" ? false : true));
  const result = await navigation.push({ name: "owner", params: { ownerId: 9 } });
  assert.equal(result.status, "cancelled");
  assert.equal(router.currentRoute.value.name, "pet");
  assert.equal(navigation.state.activeEntry.destinationEntryId, petDestinationId);
  removeGuard();
  navigation.dispose();
});

test("one shared navigation blocker cancels or confirms every navigation path", async () => {
  const { router, navigation } = await createFixture();
  const queueDestinationId = navigation.state.activeEntry.destinationEntryId;
  let dirty = true;
  const unregister = navigation.registerBlocker({
    id: "record.edit.unsaved",
    isBlocked: () => dirty,
    title: "Discard record changes?",
    message: "The unsaved record changes will be lost."
  });

  const cancelledPush = navigation.push({ name: "pet", params: { petId: 7 } });
  await waitFor(() => navigation.blockerState.pending, "navigation blocker dialog");
  assert.equal(navigation.blockerState.title, "Discard record changes?");
  navigation.cancelBlockedNavigation();
  assert.equal((await cancelledPush).status, "cancelled");
  assert.equal(router.currentRoute.value.name, "queue");
  assert.equal(navigation.state.activeEntry.destinationEntryId, queueDestinationId);

  const confirmedPush = navigation.push({ name: "pet", params: { petId: 7 } });
  await waitFor(() => navigation.blockerState.pending, "confirmed blocker dialog");
  navigation.confirmBlockedNavigation();
  assert.equal((await confirmedPush).status, "completed");
  assert.equal(router.currentRoute.value.name, "pet");

  dirty = false;
  unregister();
  navigation.dispose();
});

test("cancelled navigation restores its trigger after the Material dialog leaves", async () => {
  let focusCalls = 0;
  const trigger = {
    isConnected: true,
    focus(options) {
      focusCalls += 1;
      assert.deepEqual(options, { preventScroll: true });
    }
  };
  const { navigation } = await createFixture({ documentObject: { activeElement: trigger } });
  navigation.registerBlocker({ id: "record.edit.unsaved", isBlocked: () => true });

  const cancelledPush = navigation.push({ name: "pet", params: { petId: 7 } });
  await waitFor(() => navigation.blockerState.pending, "navigation blocker dialog");
  navigation.cancelBlockedNavigation();
  assert.equal((await cancelledPush).status, "cancelled");
  assert.equal(focusCalls, 0);
  assert.equal(navigation.restoreBlockedNavigationFocus(), true);
  assert.equal(focusCalls, 1);
  assert.equal(navigation.restoreBlockedNavigationFocus(), false);
  navigation.dispose();
});

test("pop is idempotent while one native Back operation is in flight", async () => {
  const { router, navigation } = await createFixture();
  await navigation.push({ name: "pet", params: { petId: 7 } });

  const [first, second] = await Promise.all([
    navigation.pop({ reason: "shell-back" }),
    navigation.pop({ reason: "shell-back" })
  ]);

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(first.browserEntryId, second.browserEntryId);
  assert.equal(router.currentRoute.value.name, "queue");
  navigation.dispose();
});

test("history stamping reads fresh state after another library mutates the committed entry", async () => {
  const scopeGate = createDeferredGate();
  const { history, router, navigation } = await createFixture({
    scopeResolver: async ({ route }) => {
      if (route.name === "pet") {
        await scopeGate.promise;
      }
      return { principal: "p1", surface: "admin", workspace: "w1" };
    }
  });

  const pending = navigation.push({ name: "pet", params: { petId: 7 } });
  await waitFor(() => router.currentRoute.value.name === "pet", "router commit before scope resolution");
  history.replace(history.location, {
    ...(history.state || {}),
    siblingLibrary: { token: "preserve-me" }
  });
  scopeGate.resolve();
  await pending;

  assert.deepEqual(history.state.siblingLibrary, { token: "preserve-me" });
  assert.equal(history.state.__jskit.navigation.destinationKey, "record.pet");
  navigation.dispose();
});

test("principal scope changes purge the old task and restamp the current route as a new task", async () => {
  const { history, navigation, storage } = await createFixture();
  await navigation.push({ name: "pet", params: { petId: 7 } });
  const previousTaskId = navigation.taskId;
  assert.equal(navigation.state.canPop, true);

  const result = await navigation.setScope({ principal: "p2" });

  assert.equal(result.status, "completed");
  assert.notEqual(navigation.taskId, previousTaskId);
  assert.equal(navigation.state.activeEntry.scope.principal, "p2");
  assert.equal(navigation.state.canPop, false);
  assert.equal(history.state.__jskit.navigation.taskId, navigation.taskId);
  assert.equal(await storage.readTask(previousTaskId), null);
  navigation.dispose();
});

test("concurrent scope updates commit in call order without collapsing an intermediate principal", async () => {
  const destinationPrincipals = [];
  const storage = createDestinationRecordingStorage(destinationPrincipals);
  const { navigation } = await createFixture({ storage });

  await Promise.all([
    navigation.setScope({ principal: "p2" }),
    navigation.setScope({ principal: "p3" })
  ]);

  assert.deepEqual(destinationPrincipals, ["p1", "p2", "p3"]);
  assert.equal(navigation.state.activeEntry.scope.principal, "p3");
  navigation.dispose();
});

test("replacing a conceptual destination at another URL discards its stale snapshot", async () => {
  const { navigation } = await createFixture();
  await navigation.push({ name: "owner", params: { ownerId: 9 } });
  navigation.registerContributor({
    id: "record.owner.v1",
    version: 1,
    capture: () => ({ selectedTab: "notes" })
  });
  const captured = await navigation.capture();
  const destinationEntryId = navigation.state.activeEntry.destinationEntryId;

  await navigation.replace({ name: "owner", params: { ownerId: 10 } });

  assert.equal(captured.status, "degraded");
  assert.equal(captured.reason, "storage-unavailable");
  assert.equal(typeof captured.snapshotRef, "string");
  assert.equal(navigation.state.activeEntry.destinationEntryId, destinationEntryId);
  assert.equal(navigation.state.activeEntry.fullPath, "/owner/10");
  assert.equal(navigation.state.activeEntry.snapshotRef, undefined);
  navigation.dispose();
});

test("scope changes from an ownerless boundary start a new task without an unsafe predecessor", async () => {
  const { navigation } = await createFixture({
    initial: "/auth/callback",
    scopeResolver: ({ route }) => ({
      principal: route.name === "auth-callback" ? "p1" : "p2",
      surface: "admin",
      workspace: "w1"
    })
  });
  const boundaryTaskId = navigation.taskId;

  await navigation.push({ name: "pet", params: { petId: 7 } });

  assert.notEqual(navigation.taskId, boundaryTaskId);
  assert.equal(navigation.state.activeEntry.scope.principal, "p2");
  assert.equal(navigation.state.canPop, false);
  navigation.dispose();
});

test("corrupt Forward envelopes become a new task boundary instead of enabling unsafe Up", async () => {
  const { history, router, navigation } = await createFixture();
  await navigation.push({ name: "pet", params: { petId: 7 } });
  const originalTaskId = navigation.taskId;
  history.replace(history.location, {
    ...history.state,
    __jskit: {
      ...history.state.__jskit,
      navigation: {
        ...history.state.__jskit.navigation,
        sequence: history.state.__jskit.navigation.sequence + 1
      }
    }
  });

  await navigation.goUp();
  assert.equal(router.currentRoute.value.name, "queue");
  router.forward();
  await waitFor(
    () => navigation.state.activeEntry?.taskId !== originalTaskId,
    "corrupt Forward boundary reset"
  );

  assert.equal(router.currentRoute.value.name, "pet");
  assert.equal(navigation.state.canPop, false);
  navigation.dispose();
});

test("Forward restoration reports its direction to contributors", async () => {
  const { router, navigation } = await createFixture();
  await navigation.push({ name: "pet", params: { petId: 7 } });
  await navigation.push({ name: "owner", params: { ownerId: 9 } });
  const reasons = ref([]);
  navigation.registerContributor({
    id: "record.owner.v1",
    version: 1,
    capture: () => ({ selectedTab: "summary" }),
    restoreBeforeData(_value, context) {
      reasons.value = [...reasons.value, context.reason];
    }
  });
  await navigation.capture();

  await navigation.goUp();
  router.forward();
  await waitFor(() => reasons.value.includes("forward"), "Forward contributor restoration");

  assert.deepEqual(reasons.value, ["forward"]);
  navigation.dispose();
});

test("reload exposes snapshot to setup, then restores structure, anchor scroll, and focus after readiness", async () => {
  const sharedStorage = createBrowserSessionNavigationStorage({ storage: null, logger: createLogger() });
  const first = await createFixture({
    initial: "/queue?q=Biscuit&status=confirmed",
    storage: sharedStorage
  });
  first.windowObject.scrollY = 640;
  const unregister = first.navigation.registerContributor({
    id: "work.queue.v1",
    version: 1,
    capture: () => ({ expanded: ["9011"], anchor: { itemKey: "9011", offsetY: 14 } })
  });
  const captured = await first.navigation.capture();
  assert.equal(captured.snapshotRef.length > 0, true);
  const savedState = structuredClone(first.history.state);
  unregister();
  first.navigation.dispose();

  const history = createMemoryHistory();
  const router = createRouter({ history, routes: createRoutes() });
  await router.push("/queue?q=Biscuit&status=confirmed");
  await router.isReady();
  history.replace(history.location, savedState);
  const windowObject = createWindowDouble();
  const navigation = installJskitNavigation({
    router,
    history,
    storage: sharedStorage,
    scopeResolver: () => ({ principal: "p1", surface: "admin", workspace: "w1" }),
    scrollCoordinator: createJskitNavigationScrollCoordinator(),
    cryptoObject: createCryptoSequence(),
    windowObject,
    documentObject: null,
    logger: createLogger()
  });
  await navigation.initialize();

  assert.deepEqual(navigation.peekContributorSnapshot("work.queue.v1")?.value.expanded, ["9011"]);
  const ready = ref(false);
  const events = [];
  navigation.registerContributor({
    id: "work.queue.v1",
    version: 1,
    capture: () => undefined,
    restoreBeforeData(value) {
      events.push(`seed:${value.expanded.join(",")}`);
    },
    isDataReady: () => ready.value,
    restoreStructure(value) {
      events.push(`structure:${value.expanded.join(",")}`);
    },
    resolveScrollTarget(value) {
      return {
        itemKey: value.anchor.itemKey,
        offsetY: value.anchor.offsetY,
        scroll(target) {
          events.push(`scroll:${target.itemKey}:${target.offsetY}`);
        }
      };
    },
    resolveFocusTarget() {
      return {
        focusKey: "booking-9011",
        focus() {
          events.push("focus:booking-9011");
          return true;
        }
      };
    }
  });
  navigation.notifyAppMounted();
  await waitFor(() => navigation.state.restoring, "restoration start");
  ready.value = true;
  await nextTick();
  await waitFor(() => !navigation.state.restoring, "restoration completion");

  assert.deepEqual(events, [
    "seed:9011",
    "structure:9011",
    "scroll:9011:14",
    "focus:booking-9011"
  ]);
  assert.equal(windowObject.scrollCalls.length, 0, "stable anchor wins over raw y");
  navigation.dispose();
});

test("a hanging focus contributor degrades after the configured focus timeout", async () => {
  const sharedStorage = createBrowserSessionNavigationStorage({ storage: null, logger: createLogger() });
  const first = await createFixture({ storage: sharedStorage });
  first.navigation.registerContributor({
    id: "work.queue.v1",
    version: 1,
    capture: () => ({ anchor: "queue-start" })
  });
  await first.navigation.capture();
  const savedState = structuredClone(first.history.state);
  first.navigation.dispose();

  const history = createMemoryHistory();
  const router = createRouter({ history, routes: createRoutes() });
  await router.push("/queue");
  await router.isReady();
  history.replace(history.location, savedState);
  const navigation = installJskitNavigation({
    router,
    history,
    storage: sharedStorage,
    scopeResolver: () => ({ principal: "p1", surface: "admin", workspace: "w1" }),
    scrollCoordinator: createJskitNavigationScrollCoordinator(),
    cryptoObject: createCryptoSequence(),
    windowObject: createWindowDouble(),
    documentObject: null,
    limits: { focusTimeoutMs: 10 },
    logger: createLogger()
  });
  await navigation.initialize();
  navigation.registerContributor({
    id: "work.queue.v1",
    version: 1,
    capture: () => undefined,
    resolveFocusTarget: () => new Promise(() => {})
  });
  navigation.notifyAppMounted();

  await waitFor(() => navigation.state.restoring, "focus-timeout restoration start");
  await waitFor(() => !navigation.state.restoring, "focus-timeout restoration completion");
  navigation.dispose();
});

test("a hanging capture contributor degrades at the shared readiness deadline", async () => {
  const { navigation } = await createFixture({ limits: { dataReadyTimeoutMs: 10 } });
  navigation.registerContributor({
    id: "work.queue.v1",
    version: 1,
    capture: () => new Promise(() => {})
  });

  const result = await navigation.capture();

  assert.equal(result.status, "degraded");
  assert.equal(result.reason, "contributor-capture-timeout");
  navigation.dispose();
});

test("data readiness timeout skips unsafe structure and anchor work before raw scroll fallback", async () => {
  const storage = createBrowserSessionNavigationStorage({ storage: null, logger: createLogger() });
  const first = await createFixture({ storage });
  first.windowObject.scrollY = 321;
  first.navigation.registerContributor({
    id: "work.queue.v1",
    version: 1,
    capture: () => ({ anchor: { itemKey: "9011", offsetY: 12 } })
  });
  await first.navigation.capture();
  const savedState = structuredClone(first.history.state);
  first.navigation.dispose();

  const history = createMemoryHistory();
  const router = createRouter({ history, routes: createRoutes() });
  await router.push("/queue");
  await router.isReady();
  history.replace(history.location, savedState);
  const windowObject = createWindowDouble();
  const events = [];
  const navigation = installJskitNavigation({
    router,
    history,
    storage,
    scopeResolver: () => ({ principal: "p1", surface: "admin", workspace: "w1" }),
    scrollCoordinator: createJskitNavigationScrollCoordinator(),
    cryptoObject: createCryptoSequence(),
    windowObject,
    documentObject: null,
    limits: { dataReadyTimeoutMs: 10 },
    logger: createLogger()
  });
  await navigation.initialize();
  navigation.registerContributor({
    id: "work.queue.v1",
    version: 1,
    capture: () => undefined,
    isDataReady: () => false,
    restoreStructure: () => events.push("structure"),
    resolveScrollTarget: () => ({
      itemKey: "9011",
      scroll: () => events.push("anchor-scroll")
    })
  });
  navigation.notifyAppMounted();
  await waitFor(() => navigation.state.restoring, "readiness-timeout restoration start");
  await waitFor(() => !navigation.state.restoring, "readiness-timeout restoration completion");

  assert.deepEqual(events, []);
  assert.deepEqual(windowObject.scrollCalls, [{ x: 0, y: 321 }]);
  navigation.dispose();
});

test("concurrent Up activations close one transient layer exactly once", async () => {
  const { router, navigation } = await createFixture();
  const releaseClose = createDeferredGate();
  const open = ref(true);
  const closeCalls = ref(0);
  navigation.registerTransientLayer({
    id: "test.dialog",
    isOpen: () => open.value,
    async close() {
      closeCalls.value += 1;
      await releaseClose.promise;
      open.value = false;
      return true;
    }
  });

  const first = navigation.goUp();
  const second = navigation.goUp();
  await waitFor(() => closeCalls.value === 1, "transient close start");
  releaseClose.resolve();
  const results = await Promise.all([first, second]);

  assert.deepEqual(results.map((result) => result.reason), [
    "transient-layer-closed",
    "transient-layer-closed"
  ]);
  assert.equal(closeCalls.value, 1);
  assert.equal(router.currentRoute.value.name, "queue");
  navigation.dispose();
});

function createDeferredGate() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
