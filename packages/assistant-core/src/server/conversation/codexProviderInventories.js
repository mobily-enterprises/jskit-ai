import { codexAppServerTextHasControlCharacters } from "./codexConfiguration.js";
import { isRecord, normalizePositiveInteger } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText as normalizeAgentText } from "./normalize.js";
import path from "node:path";

/** @typedef {import("./codexProvider.js").CodexAppServerAgentProvider} CodexAppServerAgentProvider */

export const CODEX_APP_SERVER_MODEL_CATALOG_PAGE_LIMIT = 100;

export const CODEX_APP_SERVER_MODEL_CATALOG_MAX_PAGES = 100;

export const CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRIES = 1000;

export const CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRY_BYTES = 32 * 1024;

export const CODEX_APP_SERVER_MODEL_CATALOG_MAX_TOTAL_BYTES = 2 * 1024 * 1024;

export const CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH = 512;

export const CODEX_APP_SERVER_THREAD_INVENTORY_PAGE_LIMIT = 100;

export const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_PAGES = 100;

export const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT = 1000;

export const CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH = 512;

export const CODEX_NATIVE_STORAGE_SOURCE_KINDS = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview",
  "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"];

export function codexAppServerThreadInventoryError(errorCode, label, detail) {
  const error = new Error(`Codex ${label} thread inventory ${detail}.`);
  error.code = errorCode;
  return error;
}

// Why a listed inventory entry is refused, or "" for a valid thread.
export function codexAppServerThreadInventoryRefusal(entry, threadId, { cwd, verifyCwd }) {
  if (!isRecord(entry)) return "listed an entry that is not a thread";
  if (!threadId) return "listed a thread without an id";
  if (threadId.length > CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH) {
    return `listed a thread id longer than ${CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH} characters`;
  }
  if (codexAppServerTextHasControlCharacters(threadId)) return "listed a thread id with control characters";
  if (verifyCwd && normalizeAgentText(entry.cwd) !== cwd) return `listed thread ${threadId} outside the requested directory`;
  return "";
}

export async function listBoundedCodexAppServerThreadIds({
  ancestorThreadId = "",
  archived = false,
  client,
  cwd = "",
  errorCode = "",
  findThreadId = "",
  label = "",
  requestLabel = "",
  runRequest,
  signal = null,
  sourceKinds = ["appServer"],
  state,
  verifyCwd = false
} = {}) {
  const seenCursors = new Set();
  let cursor = "";
  for (let page = 0; page < CODEX_APP_SERVER_THREAD_INVENTORY_MAX_PAGES; page += 1) {
    if (cursor && seenCursors.has(cursor)) {
      throw codexAppServerThreadInventoryError(
        errorCode,
        label,
        "repeated a pagination cursor"
      );
    }
    if (cursor) {
      seenCursors.add(cursor);
    }
    const response = await runRequest(
      () => client.request("thread/list", {
        archived,
        ...(cursor ? { cursor } : {}),
        ...(ancestorThreadId ? { ancestorThreadId } : cwd ? { cwd } : {}),
        limit: CODEX_APP_SERVER_THREAD_INVENTORY_PAGE_LIMIT,
        modelProviders: [],
        sourceKinds,
        useStateDbOnly: false
      }, { signal }),
      requestLabel
    );
    if (!Array.isArray(response?.data) || response.data.length > CODEX_APP_SERVER_THREAD_INVENTORY_PAGE_LIMIT) {
      throw codexAppServerThreadInventoryError(errorCode, label, "returned a malformed page");
    }
    // Only thread ids are retained, so only they are bounded. A search for one
    // thread retains none and is bounded by the page limit alone.
    if (!findThreadId && state.entryCount + response.data.length > CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT) {
      throw codexAppServerThreadInventoryError(errorCode, label,
        `exceeded its ${CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT}-thread limit`);
    }
    for (const entry of response.data) {
      const threadId = isRecord(entry) ? normalizeAgentText(entry.id) : "";
      const refusal = codexAppServerThreadInventoryRefusal(entry, threadId, { cwd, verifyCwd });
      if (refusal) {
        throw codexAppServerThreadInventoryError(errorCode, label, refusal);
      }
      if (findThreadId) {
        if (threadId === findThreadId) {
          state.found = true;
          return state;
        }
        continue;
      }
      state.entryCount += 1;
      state.threadIds.add(threadId);
    }
    const nextCursor = response.nextCursor === undefined || response.nextCursor === null || response.nextCursor === ""
      ? ""
      : typeof response.nextCursor === "string"
        ? response.nextCursor.trim()
        : null;
    if (
      nextCursor === null ||
      nextCursor.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH ||
      (nextCursor && seenCursors.has(nextCursor))
    ) {
      throw codexAppServerThreadInventoryError(
        errorCode,
        label,
        "returned an invalid pagination cursor"
      );
    }
    if (!nextCursor) {
      return state;
    }
    cursor = nextCursor;
  }
  throw codexAppServerThreadInventoryError(
    errorCode,
    label,
    "exceeded its page limit"
  );
}

/** @param {CodexAppServerAgentProvider} provider */
export async function listLoadedThreads(provider, params = {}) {
  const client = await provider.activeClient();
  return provider.runRequest(
    () => client.request("thread/loaded/list", params),
    "codex-app-server-thread-loaded-list"
  );
}

/** @param {CodexAppServerAgentProvider} provider */
export async function listAppServerThreadsForCwd(provider, {
    cwd = "",
    signal = null
  } = {}) {
  const normalizedCwd = normalizeAgentText(cwd);
  if (!normalizedCwd || codexAppServerTextHasControlCharacters(normalizedCwd)) {
    const error = new Error("Codex session thread inventory requires an exact cwd.");
    error.code = `${provider.errorPrefix}codex_session_thread_inventory_invalid`;
    throw error;
  }
  const client = await provider.activeClient();
  const state = await listBoundedCodexAppServerThreadIds({
    archived: false,
    client,
    cwd: normalizedCwd,
    errorCode: `${provider.errorPrefix}codex_session_thread_inventory_invalid`,
    label: "session",
    requestLabel: "codex-app-server-session-thread-list",
    runRequest: provider.runRequest.bind(provider),
    signal,
    state: {
      entryCount: 0,
      threadIds: new Set()
    },
    verifyCwd: true
  });
  return Object.freeze({
    cwd: normalizedCwd,
    threadIds: Object.freeze([...state.threadIds].sort())
  });
}

// Native thread/delete cascades through all spawned descendants, including
// archived and non-app-server threads. Never infer its scope from cwd alone.
/** @param {CodexAppServerAgentProvider} provider */
export async function listThreadDescendants(provider, threadId) {
  const ancestorThreadId = normalizeAgentText(threadId);
  if (!ancestorThreadId || ancestorThreadId.length > CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH ||
      codexAppServerTextHasControlCharacters(ancestorThreadId)) {
    throw new TypeError("Codex descendant inventory requires an exact thread id.");
  }
  const client = await provider.activeClient();
  const state = { entryCount: 0, threadIds: new Set() };
  for (const archived of [false, true]) {
    await listBoundedCodexAppServerThreadIds({
      ancestorThreadId, archived, client, state,
      sourceKinds: CODEX_NATIVE_STORAGE_SOURCE_KINDS,
      errorCode: `${provider.errorPrefix}codex_retirement_inventory_invalid`, label: "retirement",
      requestLabel: "codex-app-server-descendant-list", runRequest: provider.runRequest.bind(provider)
    });
  }
  return [...state.threadIds].sort();
}

/** @param {CodexAppServerAgentProvider} provider */
export async function listNativeThreadsForCwd(provider, cwd) {
  if (!path.isAbsolute(cwd || "") || codexAppServerTextHasControlCharacters(cwd)) throw new TypeError("Native inventory requires an exact absolute directory.");
  const client = await provider.activeClient();
  const state = { entryCount: 0, threadIds: new Set() };
  for (const archived of [false, true]) {
    await listBoundedCodexAppServerThreadIds({ archived, client, cwd, state, verifyCwd: true,
      sourceKinds: CODEX_NATIVE_STORAGE_SOURCE_KINDS,
      errorCode: `${provider.errorPrefix}codex_retirement_inventory_invalid`, label: "native storage",
      requestLabel: "codex-app-server-native-storage-list", runRequest: provider.runRequest.bind(provider) });
  }
  return [...state.threadIds].sort();
}

/** @param {CodexAppServerAgentProvider} provider */
export async function nativeThreadExists(provider, threadId, { signal } = {}) {
  const id = normalizeAgentText(threadId);
  if (!id || id.length > CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH || codexAppServerTextHasControlCharacters(id)) {
    throw new TypeError("Native existence checks require an exact thread id.");
  }
  const client = await provider.activeClient();
  const state = { entryCount: 0, found: false, threadIds: new Set() };
  for (const archived of [false, true]) {
    await listBoundedCodexAppServerThreadIds({ archived, client, findThreadId: id, state, signal,
      sourceKinds: CODEX_NATIVE_STORAGE_SOURCE_KINDS,
      errorCode: `${provider.errorPrefix}codex_retirement_inventory_invalid`, label: "native storage",
      requestLabel: "codex-app-server-native-existence", runRequest: provider.runRequest.bind(provider) });
    if (state.found) return true;
  }
  return false;
}

/** @param {CodexAppServerAgentProvider} provider */
export async function listHelperThreads(provider, {
    signal = null
  } = {}) {
  const client = await provider.activeClient();
  const execution = await provider.currentHelperExecutionContext();
  const state = {
    entryCount: 0,
    threadIds: new Set()
  };
  for (const archived of [false, true]) {
    await listBoundedCodexAppServerThreadIds({
      archived,
      client,
      cwd: execution.cwd,
      errorCode: `${provider.errorPrefix}codex_helper_thread_inventory_invalid`,
      label: "helper",
      requestLabel: "codex-app-server-helper-thread-list",
      runRequest: provider.runRequest.bind(provider),
      signal,
      state
    });
  }
  return Object.freeze({
    threadIds: Object.freeze([...state.threadIds].sort())
  });
}

/** @param {CodexAppServerAgentProvider} provider */
export async function listModels(provider, params = {}, {
    signal = null
  } = {}) {
  const client = await provider.activeClient();
  const data = [];
  const seenCursors = new Set();
  const includeHidden = params.includeHidden === true;
  const limit = normalizePositiveInteger(
    params.limit,
    { fallback: CODEX_APP_SERVER_MODEL_CATALOG_PAGE_LIMIT }
  );
  const boundedLimit = Math.min(limit, CODEX_APP_SERVER_MODEL_CATALOG_PAGE_LIMIT);
  let totalBytes = 0;
  let cursor = params.cursor === undefined || params.cursor === null || params.cursor === ""
    ? ""
    : typeof params.cursor === "string"
      ? params.cursor.trim()
      : null;
  if (cursor === null || cursor.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH) {
    throw provider.modelCatalogError("Codex model catalog cursor is invalid.");
  }
  for (let page = 0; page < CODEX_APP_SERVER_MODEL_CATALOG_MAX_PAGES; page += 1) {
    if (cursor && seenCursors.has(cursor)) {
      throw provider.modelCatalogError("Codex model catalog repeated a pagination cursor.");
    }
    if (cursor) {
      seenCursors.add(cursor);
    }
    const response = await provider.runRequest(
      () => client.request("model/list", {
        ...(cursor ? { cursor } : {}),
        includeHidden,
        limit: boundedLimit
      }, { signal }),
      "codex-app-server-model-list"
    );
    if (!Array.isArray(response?.data)) {
      throw provider.modelCatalogError(
        "Codex model catalog response did not contain a data array."
      );
    }
    if (
      response.data.length > boundedLimit ||
      data.length + response.data.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRIES
    ) {
      throw provider.modelCatalogError("Codex model catalog exceeded its entry limit.");
    }
    for (const entry of response.data) {
      if (!isRecord(entry)) {
        throw provider.modelCatalogError("Codex model catalog contained an invalid entry.");
      }
      let entryBytes = 0;
      try {
        entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
      } catch {
        throw provider.modelCatalogError("Codex model catalog contained an invalid entry.");
      }
      if (
        entryBytes > CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRY_BYTES ||
        totalBytes + entryBytes > CODEX_APP_SERVER_MODEL_CATALOG_MAX_TOTAL_BYTES
      ) {
        throw provider.modelCatalogError("Codex model catalog exceeded its response limit.");
      }
      totalBytes += entryBytes;
      data.push(entry);
    }
    const nextCursor = response.nextCursor === undefined || response.nextCursor === null || response.nextCursor === ""
      ? ""
      : typeof response.nextCursor === "string"
        ? response.nextCursor.trim()
        : null;
    if (nextCursor === null || nextCursor.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH) {
      throw provider.modelCatalogError("Codex model catalog cursor is invalid.");
    }
    if (!nextCursor) {
      return {
        data,
        nextCursor: null
      };
    }
    if (seenCursors.has(nextCursor)) {
      throw provider.modelCatalogError("Codex model catalog repeated a pagination cursor.");
    }
    cursor = nextCursor;
  }
  throw provider.modelCatalogError(
    `Codex model catalog exceeded ${CODEX_APP_SERVER_MODEL_CATALOG_MAX_PAGES} pages.`
  );
}

/** @param {CodexAppServerAgentProvider} provider */
export async function readConfig(provider, params = {}) {
  const client = await provider.activeClient();
  const cwd = normalizeAgentText(params.cwd);
  return provider.runRequest(
    () => client.request("config/read", {
      ...(cwd ? { cwd } : {}),
      includeLayers: params.includeLayers === true
    }),
    "codex-app-server-config-read"
  );
}

/** @param {CodexAppServerAgentProvider} provider */
export async function trustProject(provider, cwd = "") {
  if (!path.isAbsolute(cwd)) throw new TypeError("Codex project trust requires an absolute worktree path.");
  const projectRoot = path.resolve(cwd);
  const client = await provider.activeClient();
  return provider.runRequest(async () => {
    const { config } = await client.request("config/read", { cwd: projectRoot, includeLayers: false });
    if (config?.projects?.[projectRoot]?.trust_level === "trusted") return;
    // Codex discovers project hooks before applying thread config overrides.
    // Trust only this managed worktree through its native configuration API.
    await client.request("config/batchWrite", {
      edits: [{
        keyPath: `projects.${JSON.stringify(projectRoot)}.trust_level`,
        value: "trusted",
        mergeStrategy: "upsert"
      }],
      expectedVersion: null,
      filePath: null,
      reloadUserConfig: true
    });
  }, "codex-app-server-project-trust");
}

/** @param {CodexAppServerAgentProvider} provider */
export async function listHooks(provider, cwds = []) {
  const client = await provider.activeClient();
  return provider.runRequest(
    () => client.request("hooks/list", {
      cwds: (Array.isArray(cwds) ? cwds : [cwds])
        .map(normalizeAgentText)
        .filter(Boolean)
    }),
    "codex-app-server-hooks-list"
  );
}

/** @param {CodexAppServerAgentProvider} provider */
export async function writeHookTrustState(provider, state = {}) {
  if (!isRecord(state) || Object.keys(state).length === 0) {
    return null;
  }
  const client = await provider.activeClient();
  return provider.runRequest(
    () => client.request("config/batchWrite", {
      edits: [{
        keyPath: "hooks.state",
        mergeStrategy: "upsert",
        value: state
      }],
      expectedVersion: null,
      filePath: null,
      reloadUserConfig: true
    }),
    "codex-app-server-hook-trust-write"
  );
}
