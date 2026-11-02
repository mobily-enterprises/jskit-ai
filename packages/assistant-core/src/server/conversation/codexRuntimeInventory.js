import path from "node:path";
import { stat } from "node:fs/promises";
import {
  CODEX_APP_SERVER_PROCESS_STATE,
  readCodexAppServerMetadata,
  removeCodexAppServerRuntimeDir
} from "./codexProcess.js";
import { normalizeCodexRunText as normalizeText } from "./codexTurnState.js";

// Every provider owner in this process shares one inventory: one native
// runtime may serve several owners, so recovery and sharing always inspect the
// complete inventory by native runtime identity. Caller-local provider keys are
// grouped by owner without duplicating it.
export const codexAppServerProviders = new Map();
export const codexAppServerOwnedRuntimes = new Map();
export const codexAppServerRuntimeLifecycles = new Map();
// Runtimes an account change left running a turn, by native runtime identity.
export const codexAppServerStaleRuntimes = new Map();

export function codexAppServerOwnedRuntimeKey(providerKey = "", providerOptions = {}) {
  const runtimeDir = normalizeText(providerOptions?.runtimeDir);
  return runtimeDir
    ? `runtime:${path.resolve(runtimeDir)}`
    : `provider:${normalizeText(providerKey)}`;
}

export function withRuntimeLifecycle(runtimeKey, operation) {
  const previous = codexAppServerRuntimeLifecycles.get(runtimeKey) || Promise.resolve();
  const run = previous.catch(() => null).then(operation);
  const tail = run.catch(() => null).finally(() => {
    if (codexAppServerRuntimeLifecycles.get(runtimeKey) === tail) {
      codexAppServerRuntimeLifecycles.delete(runtimeKey);
    }
  });
  codexAppServerRuntimeLifecycles.set(runtimeKey, tail);
  return run;
}

// A session recorded a new runtime directory (a new sign-in gets its own), so
// its previous one is no longer used. It goes once its runtime has verifiably
// stopped; a stale runtime still finishing its turn drops it when it stops.
// Helper cleanup treats an absent directory as retired, which is also what it
// does with a previous sign-in's runtime it finds stopped.
export function releaseSupersededCodexRuntime(runtimeDir = "") {
  const runtimeKey = codexAppServerOwnedRuntimeKey("", { runtimeDir });
  return withRuntimeLifecycle(runtimeKey, async () => {
    const stale = codexAppServerStaleRuntimes.get(runtimeKey);
    if (stale) {
      stale.superseded = true;
      return { deferred: true, removed: false };
    }
    if (codexAppServerOwnedRuntimes.has(runtimeKey) || runtimePeers(runtimeKey).length) {
      return { removed: false };
    }
    const metadata = await readCodexAppServerMetadata(runtimeDir);
    if (metadata?.processState !== CODEX_APP_SERVER_PROCESS_STATE.STOPPED || !metadata.processExitVerifiedAt) {
      return { removed: false };
    }
    return { removed: await removeCodexAppServerRuntimeDir(runtimeDir) };
  });
}

export function codexAppServerRuntimeStopWasVerified(result = {}) {
  return result?.stopped === true ||
    result?.processExitVerified === true ||
    result?.runtimeDirRemoved === true;
}

export async function directoryExists(filePath = "") {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

export function* providerRecords() {
  for (const records of codexAppServerProviders.values()) yield* records.values();
}

// Every owner's provider records on one native runtime.
export function runtimePeers(runtimeKey) {
  return [...providerRecords()].filter(record =>
    codexAppServerOwnedRuntimeKey(record.providerKey, record.providerOptions) === runtimeKey);
}

export function nativeRequest(client, method, params) {
  return client.request(method, params, { signal: AbortSignal.timeout(5_000) });
}

// The loaded threads of one native runtime that have a running turn, read from
// the runtime itself so Temporary, Main and native terminal turns all count.
export async function runningNativeThreads(peers) {
  const client = peers.find(record => record.provider.client?.isOpen?.())?.provider.client;
  if (!client) return [];
  const running = [];
  const seen = new Set();
  let cursor;
  do {
    const page = await nativeRequest(client, "thread/loaded/list", { limit: 100, ...(cursor ? { cursor } : {}) });
    for (const threadId of Array.isArray(page?.data) ? page.data : []) {
      const { thread } = await nativeRequest(client, "thread/read", { threadId, includeTurns: false });
      if ((typeof thread?.status === "string" ? thread.status : thread?.status?.type) === "active") running.push(threadId);
    }
    cursor = page?.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Codex's loaded-thread inventory did not finish.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return running;
}
