import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_JSKIT_NAVIGATION_LIMITS,
  createEmptyJskitNavigationTask,
  createJskitNavigationLimits,
  createJskitNavigationResolverRegistry,
  isSafeJskitInternalFullPath,
  jskitNavigationScopesMatch,
  mergeJskitHistoryNavigationEnvelope,
  normalizeJskitNavigationTarget,
  normalizeJskitSerializableValue,
  projectJskitNavigationTask,
  readJskitHistoryNavigationEnvelope,
  reduceJskitNavigationTask,
  resolveJskitRouteNavigationMeta
} from "./navigation.js";

test("route navigation metadata resolves parent-to-child without clobbering unrelated metadata", () => {
  const route = {
    matched: [
      {
        meta: {
          jskit: {
            surface: "admin",
            navigation: {
              behavior: "destination",
              destinationKey: "admin.record",
              restore: ["record.v1"],
              persistence: { mode: "snapshot", queryAllowlist: ["tab"] }
            }
          }
        }
      },
      {
        meta: {
          jskit: {
            navigation: {
              labelKey: "navigation.record",
              persistence: { mode: "url-only" }
            }
          }
        }
      }
    ]
  };

  assert.deepEqual(resolveJskitRouteNavigationMeta(route), {
    behavior: "destination",
    destinationKey: "admin.record",
    labelKey: "navigation.record",
    restore: ["record.v1"],
    persistence: { mode: "url-only" }
  });
  assert.equal(route.matched[0].meta.jskit.surface, "admin");
});

test("destination and preserve metadata require their stable keys", () => {
  assert.throws(
    () => resolveJskitRouteNavigationMeta({ matched: [{ meta: { jskit: { navigation: { behavior: "destination" } } } }] }),
    /destinationKey/
  );
  assert.throws(
    () => resolveJskitRouteNavigationMeta({ matched: [{ meta: { jskit: { navigation: { behavior: "preserve" } } } }] }),
    /machineryKey/
  );
});

test("a child behavior change drops incompatible parent identity fields", () => {
  assert.deepEqual(resolveJskitRouteNavigationMeta({
    matched: [
      { meta: { jskit: { navigation: { behavior: "destination", destinationKey: "records.view" } } } },
      { meta: { jskit: { navigation: { behavior: "preserve", machineryKey: "records.edit" } } } }
    ]
  }), {
    behavior: "preserve",
    machineryKey: "records.edit"
  });
  assert.deepEqual(resolveJskitRouteNavigationMeta({
    matched: [
      { meta: { jskit: { navigation: { behavior: "preserve", machineryKey: "records.edit" } } } },
      { meta: { jskit: { navigation: { behavior: "boundary" } } } }
    ]
  }), { behavior: "boundary" });
});

test("safe internal paths reject external, encoded, malformed, and base-escaping locations", () => {
  assert.equal(isSafeJskitInternalFullPath("/app/records?tab=all#item"), true);
  for (const value of [
    "https://example.com/path",
    "//example.com/path",
    "javascript:alert(1)",
    "/%2f%2fevil.example/path",
    "/bad%zz",
    "/line\nbreak",
    "/back\\slash"
  ]) {
    assert.equal(isSafeJskitInternalFullPath(value), false, value);
  }
  assert.equal(isSafeJskitInternalFullPath("/other", { base: "/app/" }), false);
  assert.equal(isSafeJskitInternalFullPath("/app/records", { base: "/app/" }), true);
});

test("navigation targets reject values outside the public serializable contract", () => {
  assert.throws(
    () => normalizeJskitNavigationTarget({ name: { unsafe: true } }),
    /navigation target name must be a string/
  );
  assert.throws(
    () => normalizeJskitNavigationTarget({ path: "/records", query: { q: ["ok", 7] } }),
    /must contain strings/
  );
  assert.throws(
    () => normalizeJskitNavigationTarget({ name: "record", params: { recordId: Number.NaN } }),
    /must be a string or number/
  );
});

test("limits apply defaults and reject invalid or above-ceiling values", () => {
  assert.deepEqual(createJskitNavigationLimits(), DEFAULT_JSKIT_NAVIGATION_LIMITS);
  assert.equal(createJskitNavigationLimits({ maxEntries: 12 }).maxEntries, 12);
  assert.throws(() => createJskitNavigationLimits({ maxEntries: 0 }), /positive/);
  assert.throws(() => createJskitNavigationLimits({ maxEntries: 1000 }), /hard ceiling/);
});

test("serializable normalization rejects cycles, instances, functions, excessive depth, and size", () => {
  assert.deepEqual(normalizeJskitSerializableValue({ expanded: ["a", "b"] }), { expanded: ["a", "b"] });
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => normalizeJskitSerializableValue(cyclic), /cycle/);
  assert.throws(() => normalizeJskitSerializableValue({ callback() {} }), /function/);
  assert.throws(() => normalizeJskitSerializableValue(new Date()), /class or DOM-like/);
  assert.throws(
    () => normalizeJskitSerializableValue({ a: { b: { c: true } } }, { limits: { maxObjectDepth: 1 } }),
    /depth/
  );
  assert.throws(() => normalizeJskitSerializableValue({ text: "long" }, { maxBytes: 4 }), /byte size/);
});

test("history envelope merge preserves router and sibling JSKIT keys", () => {
  const merged = mergeJskitHistoryNavigationEnvelope(
    {
      position: 3,
      scroll: { left: 0, top: 42 },
      __jskit: { anotherModule: { ready: true } }
    },
    {
      schema: 1,
      taskId: "task-1",
      browserEntryId: "browser-1",
      sequence: 0,
      kind: "destination",
      destinationEntryId: "destination-1",
      destinationKey: "records.list"
    }
  );

  assert.equal(merged.position, 3);
  assert.deepEqual(merged.scroll, { left: 0, top: 42 });
  assert.deepEqual(merged.__jskit.anotherModule, { ready: true });
  assert.equal(readJskitHistoryNavigationEnvelope(merged)?.browserEntryId, "browser-1");
});

test("scope comparison checks only declared fields", () => {
  assert.equal(
    jskitNavigationScopesMatch(
      { principal: "p1", workspace: "w1", surface: "admin" },
      { principal: "p1", workspace: "w2", surface: "admin" },
      ["principal", "surface"]
    ),
    true
  );
  assert.equal(
    jskitNavigationScopesMatch(
      { principal: "p1", workspace: "w1" },
      { principal: "p2", workspace: "w1" },
      ["principal", "workspace"]
    ),
    false
  );
  assert.equal(
    jskitNavigationScopesMatch({}, {}, ["principal"]),
    false
  );
});

test("resolver registry rejects duplicate capability tokens", () => {
  const registry = createJskitNavigationResolverRegistry();
  const remove = registry.registerFallback("workspace.root", () => ({ name: "workspace-home" }));
  assert.equal(typeof registry.resolveFallback("workspace.root"), "function");
  assert.throws(() => registry.registerFallback("workspace.root", () => null), /already registered/);
  remove();
  assert.equal(registry.resolveFallback("workspace.root"), undefined);
});

test("task reducer projects important destinations from the browser-entry trail", () => {
  const taskId = "task-1";
  let task = createEmptyJskitNavigationTask(taskId);
  const queue = {
    schema: 1,
    taskId,
    destinationEntryId: "destination-queue",
    destinationKey: "queue.list",
    fullPath: "/queue",
    scope: { principal: "p1" },
    createdAt: 1,
    updatedAt: 1
  };
  task = reduceJskitNavigationTask(task, {
    type: "commit",
    now: 1,
    destinationEntry: queue,
    browserEntry: {
      schema: 1,
      taskId,
      browserEntryId: "browser-queue",
      sequence: 0,
      kind: "destination",
      destinationEntryId: queue.destinationEntryId,
      fullPath: queue.fullPath,
      createdAt: 1
    }
  });
  task = reduceJskitNavigationTask(task, {
    type: "commit",
    now: 2,
    browserEntry: {
      schema: 1,
      taskId,
      browserEntryId: "browser-edit",
      sequence: 1,
      kind: "machinery",
      destinationEntryId: queue.destinationEntryId,
      previousJskitBrowserEntryId: "browser-queue",
      machineryKey: "queue.edit",
      fullPath: "/queue/edit",
      createdAt: 2
    }
  });

  const projection = projectJskitNavigationTask(task);
  assert.equal(projection.canPop, true);
  assert.deepEqual(projection.browserTrail.map((entry) => entry.browserEntryId), ["browser-edit", "browser-queue"]);
  assert.deepEqual(projection.destinationTrail.map((entry) => entry.destinationEntryId), [
    "destination-queue",
    "destination-queue"
  ]);
});
