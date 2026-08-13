import assert from "node:assert/strict";
import test from "node:test";
import {
  NAVIGATION_STORAGE_PREFIX,
  createBrowserSessionNavigationStorage
} from "./navigationStorage.js";

function createStorageDouble({ failWrites = false } = {}) {
  const entries = new Map();
  return {
    get length() {
      return entries.size;
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      if (failWrites) {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    }
  };
}

function createEntries(taskId = "task-1") {
  const destination = {
    schema: 1,
    taskId,
    destinationEntryId: "destination-1",
    destinationKey: "records.list",
    fullPath: "/records",
    scope: { principal: "p1" },
    createdAt: 1,
    updatedAt: 1
  };
  const browser = {
    schema: 1,
    taskId,
    browserEntryId: "browser-1",
    sequence: 0,
    kind: "destination",
    destinationEntryId: destination.destinationEntryId,
    fullPath: destination.fullPath,
    createdAt: 1
  };
  return { destination, browser };
}

test("session navigation storage writes and reads task entries and snapshots", async () => {
  const backing = createStorageDouble();
  const storage = createBrowserSessionNavigationStorage({
    storage: backing,
    now: () => 100,
    cryptoObject: { randomUUID: () => "snapshot-1" }
  });
  const { destination, browser } = createEntries();

  await storage.writeDestination(destination);
  await storage.writeBrowserEntry(browser);
  const snapshotRef = await storage.writeSnapshot("task-1", {
    schema: 1,
    destinationEntryId: destination.destinationEntryId,
    route: { fullPath: "/records?q=a", path: "/records", query: { q: "a" }, hash: "" },
    contributors: { "records.list.v1": { version: 1, value: { expanded: ["r1"] } } },
    capturedAt: 100
  });

  assert.equal(storage.available, true);
  assert.equal((await storage.readBrowserEntry("task-1", "browser-1"))?.fullPath, "/records");
  assert.equal((await storage.readDestination("task-1", "destination-1"))?.destinationKey, "records.list");
  assert.deepEqual((await storage.readSnapshot("task-1", snapshotRef))?.contributors, {
    "records.list.v1": { version: 1, value: { expanded: ["r1"] } }
  });
});

test("session navigation storage degrades to memory when browser storage is unavailable", async () => {
  const warnings = [];
  const storage = createBrowserSessionNavigationStorage({
    storage: createStorageDouble({ failWrites: true }),
    logger: { warn(payload) { warnings.push(payload); } }
  });
  const { destination, browser } = createEntries();

  await storage.writeDestination(destination);
  await storage.writeBrowserEntry(browser);

  assert.equal(storage.available, false);
  assert.equal((await storage.readDestination("task-1", "destination-1"))?.destinationKey, "records.list");
  assert.equal((await storage.readBrowserEntry("task-1", "browser-1"))?.kind, "destination");
  assert.equal(warnings.length >= 1, true);
});

test("session navigation storage expires snapshots and purges a task namespace", async () => {
  let time = 1;
  const backing = createStorageDouble();
  const storage = createBrowserSessionNavigationStorage({
    storage: backing,
    now: () => time,
    limits: { ttlMs: 10 },
    cryptoObject: { randomUUID: () => "snapshot-1" }
  });
  const { destination, browser } = createEntries();
  await storage.writeDestination(destination);
  await storage.writeBrowserEntry(browser);
  const snapshotRef = await storage.writeSnapshot("task-1", {
    schema: 1,
    destinationEntryId: "destination-1",
    route: { fullPath: "/records", path: "/records", query: {}, hash: "" },
    contributors: {},
    capturedAt: time
  });

  time = 20;
  assert.equal(await storage.readSnapshot("task-1", snapshotRef), null);
  await storage.deleteTask("task-1");
  assert.equal(await storage.readTask("task-1"), null);
});

test("corrupt JSON is isolated without disabling usable session storage", async () => {
  const warnings = [];
  const backing = createStorageDouble();
  backing.setItem(`${NAVIGATION_STORAGE_PREFIX}task-1:task`, "{not-json");
  const storage = createBrowserSessionNavigationStorage({
    storage: backing,
    logger: { warn(payload) { warnings.push(payload); } }
  });

  assert.equal(await storage.readTask("task-1"), null);
  assert.equal(storage.available, true);
  const { destination } = createEntries();
  await storage.writeDestination(destination);
  assert.equal((await storage.readDestination("task-1", "destination-1"))?.destinationKey, "records.list");
  assert.equal(warnings.some((entry) => entry.navigation?.reason === "corrupt-record"), true);
});

test("snapshot ids require cryptographically secure randomness", async () => {
  const storage = createBrowserSessionNavigationStorage({
    storage: createStorageDouble(),
    cryptoObject: {}
  });
  await assert.rejects(
    storage.writeSnapshot("task-1", {
      schema: 1,
      destinationEntryId: "destination-1",
      route: { fullPath: "/records", path: "/records", query: {}, hash: "" },
      contributors: {},
      capturedAt: 1
    }),
    /cryptographically secure/
  );
});
