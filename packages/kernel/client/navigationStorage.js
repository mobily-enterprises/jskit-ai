import {
  JSKIT_NAVIGATION_SCHEMA_VERSION,
  createEmptyJskitNavigationTask,
  createJskitNavigationLimits,
  normalizeJskitSerializableValue,
  reduceJskitNavigationTask
} from "../shared/navigation.js";
import {
  createSecureNavigationId,
  isRecord,
  measureUtf8Bytes,
  normalizeRequiredText
} from "../shared/navigationInternals.js";

const NAVIGATION_STORAGE_PREFIX = `jskit:navigation:v${JSKIT_NAVIGATION_SCHEMA_VERSION}:`;

function currentTime() {
  return Date.now();
}

function normalizeId(value, field) {
  return normalizeRequiredText(value, field);
}

function compareLastSeenDescending(left, right) {
  return Number(right?.lastSeenAt || right?.[1]?.lastSeenAt || 0) -
    Number(left?.lastSeenAt || left?.[1]?.lastSeenAt || 0);
}

function createBrowserSessionNavigationStorageContext({
  storage = typeof sessionStorage === "undefined" ? null : sessionStorage,
  limits: limitOverrides = {},
  now = currentTime,
  cryptoObject = globalThis.crypto,
  logger = console
} = {}) {
  const repository = {
    storage,
    limits: createJskitNavigationLimits(limitOverrides),
    now,
    cryptoObject,
    logger,
    memoryTasks: new Map(),
    memorySnapshots: new Map(),
    storageAvailable: false
  };
  repository.storageAvailable = probeStorage(repository);
  return repository;
}

function taskKey(taskId) {
  return `${NAVIGATION_STORAGE_PREFIX}${normalizeId(taskId, "navigation task id")}:task`;
}

function snapshotKey(taskId, snapshotRef) {
  return `${NAVIGATION_STORAGE_PREFIX}${normalizeId(taskId, "navigation task id")}:snapshot:${normalizeId(snapshotRef, "snapshot ref")}`;
}

function reportStorageFailure(repository, error, operation) {
  repository.storageAvailable = false;
  repository.logger?.warn?.(
    {
      navigation: {
        operation,
        reason: String(error?.name || "storage-unavailable")
      }
    },
    "JSKIT navigation storage degraded to memory."
  );
}

function reportCorruptRecord(repository, operation) {
  repository.logger?.warn?.(
    {
      navigation: {
        operation,
        reason: "corrupt-record"
      }
    },
    "JSKIT navigation discarded corrupt session state."
  );
}

function probeStorage(repository) {
  const storage = repository.storage;
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    return false;
  }
  const probeKey = `${NAVIGATION_STORAGE_PREFIX}probe`;
  try {
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return true;
  } catch (error) {
    reportStorageFailure(repository, error, "probe");
    return false;
  }
}

function removeStoredKey(repository, key) {
  if (!repository.storageAvailable) {
    return;
  }
  try {
    repository.storage.removeItem(key);
  } catch (error) {
    reportStorageFailure(repository, error, "remove");
  }
}

function readStoredJson(repository, key) {
  if (!repository.storageAvailable) {
    return null;
  }
  let serialized;
  try {
    serialized = repository.storage.getItem(key);
  } catch (error) {
    reportStorageFailure(repository, error, "read");
    return null;
  }
  if (!serialized) {
    return null;
  }
  try {
    return JSON.parse(serialized);
  } catch {
    removeStoredKey(repository, key);
    reportCorruptRecord(repository, "parse");
    return null;
  }
}

function writeStoredJson(repository, key, value) {
  if (!repository.storageAvailable) {
    return false;
  }
  try {
    repository.storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    reportStorageFailure(repository, error, "write");
    return false;
  }
}

function listStoredKeys(repository, operation) {
  if (!repository.storageAvailable) {
    return [];
  }
  try {
    const keys = [];
    for (let index = 0; index < repository.storage.length; index += 1) {
      const key = repository.storage.key(index);
      if (typeof key === "string") {
        keys.push(key);
      }
    }
    return keys;
  } catch (error) {
    reportStorageFailure(repository, error, operation);
    return [];
  }
}

function normalizeTask(repository, value, expectedTaskId) {
  if (
    !isRecord(value) ||
    value.schema !== JSKIT_NAVIGATION_SCHEMA_VERSION ||
    value.taskId !== expectedTaskId ||
    !isRecord(value.browserEntries) ||
    !isRecord(value.destinations)
  ) {
    return null;
  }
  try {
    return normalizeJskitSerializableValue(value, {
      limits: repository.limits,
      maxBytes: repository.limits.maxTaskBytes
    });
  } catch {
    return null;
  }
}

async function readTask(repository, taskId) {
  const normalizedTaskId = normalizeId(taskId, "navigation task id");
  const key = taskKey(normalizedTaskId);
  const storedValue = readStoredJson(repository, key);
  const stored = normalizeTask(repository, storedValue, normalizedTaskId);
  if (stored) {
    repository.memoryTasks.set(normalizedTaskId, stored);
    return stored;
  }
  if (storedValue) {
    removeStoredKey(repository, key);
    reportCorruptRecord(repository, "read-task");
  }
  return normalizeTask(repository, repository.memoryTasks.get(normalizedTaskId), normalizedTaskId);
}

async function writeTask(repository, task) {
  const taskId = normalizeId(task?.taskId, "navigation task id");
  const normalized = normalizeTask(repository, task, taskId);
  if (!normalized) {
    throw new TypeError("JSKIT navigation storage received an invalid or oversized task.");
  }
  repository.memoryTasks.set(taskId, normalized);
  writeStoredJson(repository, taskKey(taskId), normalized);
}

async function readBrowserEntry(repository, taskId, browserEntryId) {
  const task = await readTask(repository, taskId);
  const entry = task?.browserEntries?.[normalizeId(browserEntryId, "browser entry id")]?.entry;
  return isRecord(entry) && entry.schema === JSKIT_NAVIGATION_SCHEMA_VERSION ? entry : null;
}

async function writeBrowserEntry(repository, entry) {
  const taskId = normalizeId(entry?.taskId, "navigation task id");
  const task = (await readTask(repository, taskId)) || createEmptyJskitNavigationTask(taskId);
  await writeTask(repository, reduceJskitNavigationTask(task, {
    type: "commit",
    browserEntry: entry,
    now: repository.now()
  }));
}

async function readDestination(repository, taskId, destinationEntryId) {
  const task = await readTask(repository, taskId);
  const entry = task?.destinations?.[normalizeId(destinationEntryId, "destination entry id")]?.entry;
  return isRecord(entry) && entry.schema === JSKIT_NAVIGATION_SCHEMA_VERSION ? entry : null;
}

async function writeDestination(repository, entry) {
  const taskId = normalizeId(entry?.taskId, "navigation task id");
  const task = (await readTask(repository, taskId)) || createEmptyJskitNavigationTask(taskId);
  await writeTask(repository, reduceJskitNavigationTask(task, {
    type: "write-destination",
    destinationEntry: entry,
    now: repository.now()
  }));
}

async function readSnapshot(repository, taskId, snapshotRef) {
  const normalizedTaskId = normalizeId(taskId, "navigation task id");
  const normalizedRef = normalizeId(snapshotRef, "snapshot ref");
  const key = snapshotKey(normalizedTaskId, normalizedRef);
  const storedRecord = readStoredJson(repository, key);
  const record = storedRecord || repository.memorySnapshots.get(key);
  if (
    !isRecord(record) ||
    record.schema !== JSKIT_NAVIGATION_SCHEMA_VERSION ||
    record.taskId !== normalizedTaskId ||
    record.snapshotRef !== normalizedRef ||
    !isRecord(record.snapshot) ||
    record.snapshot.schema !== JSKIT_NAVIGATION_SCHEMA_VERSION ||
    !String(record.snapshot.destinationEntryId || "").trim()
  ) {
    if (record) {
      repository.memorySnapshots.delete(key);
      removeStoredKey(repository, key);
      reportCorruptRecord(repository, "read-snapshot");
    }
    return null;
  }
  if (repository.now() - Number(record.lastSeenAt || 0) > repository.limits.ttlMs) {
    repository.memorySnapshots.delete(key);
    removeStoredKey(repository, key);
    return null;
  }
  let normalizedSnapshot;
  try {
    normalizedSnapshot = normalizeJskitSerializableValue(record.snapshot, {
      limits: repository.limits,
      maxBytes: repository.limits.maxSnapshotBytes
    });
  } catch {
    repository.memorySnapshots.delete(key);
    removeStoredKey(repository, key);
    reportCorruptRecord(repository, "read-snapshot");
    return null;
  }
  const refreshedRecord = {
    ...record,
    snapshot: normalizedSnapshot,
    lastSeenAt: repository.now(),
    bytes: measureUtf8Bytes(JSON.stringify(normalizedSnapshot))
  };
  repository.memorySnapshots.set(key, refreshedRecord);
  writeStoredJson(repository, key, refreshedRecord);
  return normalizedSnapshot;
}

async function writeSnapshot(repository, taskId, snapshot) {
  const normalizedTaskId = normalizeId(taskId, "navigation task id");
  if (snapshot?.schema !== JSKIT_NAVIGATION_SCHEMA_VERSION) {
    throw new TypeError("JSKIT navigation snapshot must use schema version 1.");
  }
  const normalizedSnapshot = normalizeJskitSerializableValue(snapshot, {
    limits: repository.limits,
    maxBytes: repository.limits.maxSnapshotBytes
  });
  const snapshotRef = `${normalizeId(snapshot.destinationEntryId, "snapshot destination entry id")}-${createSecureNavigationId("", repository.cryptoObject)}`;
  const key = snapshotKey(normalizedTaskId, snapshotRef);
  const record = {
    schema: JSKIT_NAVIGATION_SCHEMA_VERSION,
    taskId: normalizedTaskId,
    snapshotRef,
    snapshot: normalizedSnapshot,
    lastSeenAt: repository.now(),
    bytes: measureUtf8Bytes(JSON.stringify(normalizedSnapshot))
  };
  repository.memorySnapshots.set(key, record);
  writeStoredJson(repository, key, record);
  await prune(repository, repository.now(), repository.limits);
  return snapshotRef;
}

async function deleteTask(repository, taskId) {
  const normalizedTaskId = normalizeId(taskId, "navigation task id");
  const prefix = `${NAVIGATION_STORAGE_PREFIX}${normalizedTaskId}:`;
  repository.memoryTasks.delete(normalizedTaskId);
  for (const key of repository.memorySnapshots.keys()) {
    if (key.startsWith(prefix)) {
      repository.memorySnapshots.delete(key);
    }
  }
  if (!repository.storageAvailable) {
    return;
  }
  for (const key of listStoredKeys(repository, "enumerate-delete-task")) {
    if (key.startsWith(prefix)) {
      removeStoredKey(repository, key);
    }
  }
}

function collectSnapshotRecords(repository) {
  const records = new Map(repository.memorySnapshots);
  if (!repository.storageAvailable) {
    return records;
  }
  for (const key of listStoredKeys(repository, "enumerate-snapshots")) {
    if (!key.startsWith(NAVIGATION_STORAGE_PREFIX) || !key.includes(":snapshot:")) {
      continue;
    }
    const record = readStoredJson(repository, key);
    if (record) {
      records.set(key, record);
    }
  }
  return records;
}

function collectTaskRecords(repository) {
  const records = new Map(repository.memoryTasks);
  if (!repository.storageAvailable) {
    return records;
  }
  for (const key of listStoredKeys(repository, "enumerate-tasks")) {
    if (!key.startsWith(NAVIGATION_STORAGE_PREFIX) || !key.endsWith(":task")) {
      continue;
    }
    const candidate = readStoredJson(repository, key);
    const taskId = String(candidate?.taskId || "").trim();
    const task = taskId ? normalizeTask(repository, candidate, taskId) : null;
    if (task) {
      records.set(taskId, task);
    } else if (candidate) {
      removeStoredKey(repository, key);
      reportCorruptRecord(repository, "prune-task");
    }
  }
  return records;
}

function pruneTask(repository, taskId, sourceTask, timestamp, limits) {
  const browserRecords = [];
  for (const record of Object.values(sourceTask.browserEntries || {})) {
    if (timestamp - Number(record?.lastSeenAt || 0) <= limits.ttlMs) {
      browserRecords.push(record);
    }
  }
  browserRecords.sort(compareLastSeenDescending);
  const keptBrowserRecords = browserRecords.slice(0, limits.maxEntries);
  if (keptBrowserRecords.length === 0) {
    repository.memoryTasks.delete(taskId);
    removeStoredKey(repository, taskKey(taskId));
    return;
  }

  const browserEntries = {};
  const referencedDestinations = new Set();
  for (const record of keptBrowserRecords) {
    browserEntries[record.entry.browserEntryId] = record;
    if (record.entry.destinationEntryId) {
      referencedDestinations.add(record.entry.destinationEntryId);
    }
  }
  const destinations = {};
  for (const [destinationEntryId, record] of Object.entries(sourceTask.destinations || {})) {
    const unexpired = timestamp - Number(record?.lastSeenAt || 0) <= limits.ttlMs;
    if (referencedDestinations.has(destinationEntryId) && unexpired) {
      destinations[destinationEntryId] = record;
    }
  }
  const nextTask = {
    schema: JSKIT_NAVIGATION_SCHEMA_VERSION,
    taskId,
    browserEntries,
    destinations,
    activeBrowserEntryId: browserEntries[sourceTask.activeBrowserEntryId]
      ? sourceTask.activeBrowserEntryId
      : keptBrowserRecords[0].entry.browserEntryId
  };
  repository.memoryTasks.set(taskId, nextTask);
  writeStoredJson(repository, taskKey(taskId), nextTask);
}

async function prune(repository, timestamp = repository.now(), requestedLimits = repository.limits) {
  const effectiveLimits = requestedLimits === repository.limits
    ? repository.limits
    : createJskitNavigationLimits(requestedLimits);
  for (const [taskId, sourceTask] of collectTaskRecords(repository)) {
    pruneTask(repository, taskId, sourceTask, timestamp, effectiveLimits);
  }

  const snapshotRecords = [];
  for (const entry of collectSnapshotRecords(repository).entries()) {
    if (isRecord(entry[1])) {
      snapshotRecords.push(entry);
    }
  }
  snapshotRecords.sort(compareLastSeenDescending);
  const taskBytes = new Map();
  const taskSnapshotCounts = new Map();
  for (const [key, record] of snapshotRecords) {
    const expired = timestamp - Number(record.lastSeenAt || 0) > effectiveLimits.ttlMs;
    const currentBytes = taskBytes.get(record.taskId) || 0;
    const currentCount = taskSnapshotCounts.get(record.taskId) || 0;
    const recordBytes = Number(
      record.bytes || measureUtf8Bytes(JSON.stringify(record.snapshot || {}))
    );
    const overBudget = currentBytes + recordBytes > effectiveLimits.maxTaskBytes ||
      currentCount >= effectiveLimits.maxEntries;
    if (expired || overBudget) {
      repository.memorySnapshots.delete(key);
      removeStoredKey(repository, key);
      continue;
    }
    taskBytes.set(record.taskId, currentBytes + recordBytes);
    taskSnapshotCounts.set(record.taskId, currentCount + 1);
  }
}

function createBrowserSessionNavigationStorage(options = {}) {
  const repository = createBrowserSessionNavigationStorageContext(options);

  return Object.freeze({
    get available() {
      return repository.storageAvailable;
    },
    readTask(taskId) {
      return readTask(repository, taskId);
    },
    writeTask(task) {
      return writeTask(repository, task);
    },
    readBrowserEntry(taskId, browserEntryId) {
      return readBrowserEntry(repository, taskId, browserEntryId);
    },
    writeBrowserEntry(entry) {
      return writeBrowserEntry(repository, entry);
    },
    readDestination(taskId, destinationEntryId) {
      return readDestination(repository, taskId, destinationEntryId);
    },
    writeDestination(entry) {
      return writeDestination(repository, entry);
    },
    readSnapshot(taskId, snapshotRef) {
      return readSnapshot(repository, taskId, snapshotRef);
    },
    writeSnapshot(taskId, snapshot) {
      return writeSnapshot(repository, taskId, snapshot);
    },
    deleteTask(taskId) {
      return deleteTask(repository, taskId);
    },
    prune(timestamp, limits) {
      return prune(repository, timestamp, limits);
    }
  });
}

export {
  NAVIGATION_STORAGE_PREFIX,
  createBrowserSessionNavigationStorage
};
